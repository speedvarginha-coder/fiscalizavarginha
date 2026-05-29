# Arquitetura — Fiscaliza Varginha

Este documento descreve **como o painel funciona** por dentro: onde os dados vivem, como são carregados, quais módulos existem, e como tudo se conecta.

Leia isto antes de mexer no código.

---

## 1. Visão de 30 segundos

```
                 ┌─────────────────────────────────────────────────┐
                 │           NAVEGADOR DO CIDADÃO                  │
                 │                                                 │
   ┌───────────► │  1. Abre prefeitura.html                        │
   │             │  2. <body data-page="prefeitura">               │
   │             │  3. data-loader.js descobre quais chunks precisa│
   │             │  4. fetch() paralelo em data/chunks/*.json      │
   │             │  5. Carrega modules/*.js (utils, icons, ...)    │
   │             │  6. Carrega app.js (orquestrador único)         │
   │             │  7. app.js renderiza a página                   │
   │             └─────────────────────────────────────────────────┘
   │
   │             ┌──────────────────────────────────┐
   └─────────────│ Service Worker (sw.js)           │
                 │ cache offline + atualização bg   │
                 └──────────────────────────────────┘

PIPELINE DE DADOS (offline, roda no servidor de quem mantém o painel):

  Portal Betha API ──► coletor*.py ──► data/*.json ──► data.js ──► chunks/*.json
                                       (intermediário)              (servidos ao browser)
```

---

## 2. Estrutura de pastas

```
3_Fiscaliza Varginha/
├── .gitignore                  Protege tokens, logs, caches
├── package.json                npm scripts (npm test)
├── playwright.config.js        Config dos testes
│
├── private/                    [GITIGNORED — nunca publica]
│   ├── tokens/                 Tokens OAuth do Betha
│   └── logs/                   debug.log do coletor
│
├── painel-cidadao/             [Pasta pública — vai para Hostinger]
│   ├── index.html              Página inicial
│   ├── prefeitura.html         Contratos, diárias, eventos, etc.
│   ├── camara.html             Vereadores, emendas
│   ├── relatorios.html         Sinais de atenção, comparativos
│   ├── pessoal.html            Folha de pagamento
│   ├── marcadores.html         Watchlist pessoal do cidadão
│   ├── sobre.html              Metodologia + glossário
│   ├── cobrar.html             Canais oficiais (LAI, e-SIC)
│   │
│   ├── style.css               CSS único (5000+ linhas — a refatorar)
│   ├── app.js                  Lógica principal (~5700 linhas)
│   ├── app-glossario.js        Glossário standalone p/ sobre.html
│   ├── data-loader.js          Carregador async de dados+módulos
│   ├── sw.js                   Service Worker (cache offline)
│   ├── favicon.svg
│   │
│   ├── modules/                Módulos JS extraídos do app.js
│   │   ├── utils.js            Formatadores, esc, cleanText, norm
│   │   ├── icons.js            Ícones SVG (Heroicons)
│   │   ├── glossario.js        Termos cidadãos
│   │   ├── categorias.js       Saúde, Educação, Obras, ...
│   │   └── watchlist.js        Marcadores em localStorage
│   │
│   ├── data/
│   │   ├── chunks/             14 JSONs servidos por domínio
│   │   │   ├── prefeitura.json
│   │   │   ├── emendas.json
│   │   │   ├── diarias.json
│   │   │   └── ...
│   │   └── manifest.json       Tamanhos dos chunks
│   │
│   ├── data.js                 [LEGADO] Bundle único 8.7MB (fallback)
│   │
│   └── coletor*.py             Scripts Python que populam o data/
│
├── tests/
│   ├── smoke.spec.js           41 testes Playwright
│   └── README.md
│
└── docs/                       Esta pasta
    ├── arquitetura.md          [VOCÊ ESTÁ AQUI]
    ├── fontes-de-dados.md
    ├── como-atualizar.md
    ├── como-publicar.md
    └── checklist-publicacao.md
```

---

## 3. O ciclo de vida de um carregamento

### Quando o usuário abre `prefeitura.html`:

**Passo 1 — HTML carrega o data-loader:**
```html
<body data-page="prefeitura">
  ...
  <script src="data-loader.js?v=20260520"></script>
</body>
```

**Passo 2 — `data-loader.js` descobre o que precisa:**
```js
const CHUNKS_POR_PAGINA = {
  "prefeitura": ["prefeitura", "emendas", "diarias", "cnpjs", "pncp",
                 "vereadores", "atualizado_em"],
  ...
};
const page = body.dataset.page;       // "prefeitura"
const chunks = CHUNKS_POR_PAGINA[page]; // ["prefeitura", ...]
```

**Passo 3 — Fetch paralelo:**
```js
const resultados = await Promise.all(
  chunks.map(key => fetch(`data/chunks/${key}.json`))
);
// resultados → [prefeitura.json, emendas.json, diarias.json, ...]
```

**Passo 4 — Monta `window.ZELA_DATA`:**
```js
resultados.forEach(({ key, data }) => {
  window.ZELA_DATA[key] = data;
});
// Agora window.ZELA_DATA.prefeitura.contratos existe
```

**Passo 5 — Carrega módulos em ordem:**
```js
const MODULOS = [
  "modules/utils.js",       // Define window.ZELA.utils
  "modules/icons.js",       // Define window.ZELA.icon()
  "modules/glossario.js",   // Define window.ZELA.simplificarTermo()
  "modules/categorias.js",  // Define window.ZELA.categorias
  "modules/watchlist.js",   // Define window.ZELA.watchlist
];
for (const m of MODULOS) await loadScript(m);
```

**Passo 6 — Carrega `app.js`:**
```js
await loadScript("app.js");
```

**Passo 7 — `app.js` lê `window.ZELA_DATA` e renderiza:**
```js
const D = window.ZELA_DATA;
const pf = D.prefeitura || {};
// ...renderiza contratos, placar, gráficos, etc.
```

**Passo 8 — Evento global de pronto:**
```js
window.dispatchEvent(new CustomEvent("zela:ready", { detail: { chunks } }));
```

Páginas como `marcadores.html` escutam esse evento para renderizar conteúdo dependente de dados.

---

## 4. Os módulos (modules/)

Cada módulo é uma IIFE auto-contida que **expõe API em `window.ZELA.*`**. Não usa `import/export` (sem build step).

### `modules/utils.js` (11 funções, ~6.5KB)

Utilitários puros, sem efeito colateral.

| Função | O que faz |
|--------|-----------|
| `fmtBRL(n)` | Formata número como "R$ 1.234,56" |
| `fmtMi(n)` | "R$ 1,2 mi" |
| `fmtNum(n)` | Localiza número pt-BR |
| `cleanText(s)` | Corrige mojibake (Ã§ → ç) e caracteres corrompidos |
| `esc(s)` | Escape HTML (`<` → `&lt;`) |
| `jsSafe(s)` | Escape para uso em `onclick="...'$s'..."` |
| `norm(s)` | Lowercase sem acentos (para busca) |
| `highlight(text, q)` | Envolve match com `<mark>` |
| `scrollToEl(el)` | Scroll suave respeitando prefers-reduced-motion |
| `exportCSV(rows, cols, filename)` | Gera CSV e baixa |

**Uso interno (em app.js):**
```js
const { fmtBRL, esc, cleanText } = window.ZELA.utils;
```

### `modules/icons.js` (23 ícones SVG)

Biblioteca de ícones inline estilo Heroicons (MIT). Substitui emojis em UI.

**Uso:**
```js
window.ZELA.icon("saude")            // <svg>...</svg> tamanho 20px
window.ZELA.icon("trofeu", { size: 24 })
window.ZELA.icon("alerta", { class: "icon-alert" })
```

**Catálogo:**
- Categorias: `saude`, `educacao`, `obras`, `transporte`, `cultura`, `assistencia`, `administracao`, `seguranca`
- Placar: `cifrao`, `trofeu`, `documentos`, `alerta`, `cheque`
- Ações: `copiar`, `lupa`, `predio`, `relogio`, `grafico`, `sinal`, `fechar`, `estrela`, `estrelaCheia`, `seta`, `setaCima`, `limpar`

### `modules/glossario.js`

Traduz jargão técnico em linguagem cidadã.

```js
window.ZELA.simplificarTermo("Favorecido")    // → "Quem recebeu"
window.ZELA.termoCidadao("modalidade")        // → <span title="...">Tipo de compra</span>
```

### `modules/categorias.js`

Classifica contratos/emendas em 8 categorias.

```js
const item = { objeto: "Aquisição de medicamentos..." };
window.ZELA.classificarItem(item);  // → "saúde"
window.ZELA.categorias              // → [{id, iconKey, label, kw}, ...]
```

### `modules/watchlist.js`

Marcadores pessoais do cidadão (salvos em `localStorage`).

```js
window.ZELA.watchlist.toggle("contratos", "123/2026")  // adiciona ou remove
window.ZELA.watchlist.has("emendas", "55/2025")        // true | false
window.ZELA.watchlist.botao("contratos", id)           // HTML do botão ⭐
```

---

## 5. Dados — chunks vs data.js

### Antes (legado)

```html
<script src="data.js"></script>   <!-- 8.7 MB carregado em TODA página -->
```

Variável global: `window.ZELA_DATA = { prefeitura, emendas, diarias, ... }`

### Agora (chunks)

```html
<script src="data-loader.js"></script>
<!-- Carrega só os chunks que a página precisa -->
```

**Economia por página:**

| Página | data.js (antes) | chunks (agora) | Economia |
|--------|-----------------|----------------|----------|
| index.html | 8.74 MB | 0.82 MB | **90.6%** |
| marcadores.html | 8.74 MB | 0.79 MB | **91.0%** |
| pessoal.html | 8.74 MB | 1.73 MB | **80.2%** |
| relatorios.html | 8.74 MB | 1.95 MB | **77.6%** |
| prefeitura.html | 8.74 MB | 3.36 MB | **61.6%** |
| camara.html | 8.74 MB | 4.44 MB | **49.2%** |
| sobre.html, cobrar.html | 8.74 MB | 0 MB | **100%** |

### `data.js` ainda existe — é o **fallback**

Quando o painel é aberto direto do disco (`file://`), o `fetch()` não funciona. O loader detecta e carrega `data.js` monolítico.

---

## 6. Service Worker (`sw.js`)

Cache offline + atualização em background.

**Estratégia por tipo de recurso:**

| Recurso | Estratégia |
|---------|------------|
| HTML, CSS, JS estáticos | Cache-first |
| `data/chunks/*.json` | Stale-while-revalidate |
| `data.js` (legado) | Stale-while-revalidate |
| Outros | Cache-first com fallback network |

**Notificação de atualização:**

Quando o SW detecta que um chunk mudou em background, posta mensagem aos clientes:
```js
{ type: "DATA_UPDATED", chunk: "/data/chunks/prefeitura.json" }
```

O `app.js` escuta e mostra um toast no canto superior direito convidando o usuário a recarregar.

**Versionamento:** `const CACHE = "zela-v8"` — bumpar quando há mudança quebradora; ativação remove caches antigos.

---

## 7. Como adicionar uma página nova

1. **Criar `nova.html`** copiando layout de uma existente.
2. **Adicionar `<body data-page="nova">`**.
3. **Mapear chunks em `data-loader.js`:**
   ```js
   const CHUNKS_POR_PAGINA = {
     ...,
     "nova": ["prefeitura", "atualizado_em"],
   };
   ```
4. **Adicionar ao SW (`sw.js`):**
   ```js
   const STATIC = [..., "./nova.html"];
   ```
5. **Bumpar `CACHE = "zela-vN"`** para forçar refresh.
6. **Adicionar ao nav** das outras páginas:
   ```html
   <a href="nova.html" class="nav__link">Nova</a>
   ```
7. **Adicionar smoke test** em `tests/smoke.spec.js`:
   ```js
   { arquivo: "nova.html", titulo: /Nova/, bloco: "#novoBloco" },
   ```
8. **Rodar testes:** `npm test`.

---

## 8. Princípios de design

### Sem build step
- Vanilla JS, sem webpack/vite/rollup.
- Cada arquivo `.js` é executável direto pelo browser.
- IIFE para encapsular escopo.
- API exposta em `window.ZELA.*`.

### Retrocompatibilidade
- `data.js` legado funciona como fallback.
- `app.js` destrutura `window.ZELA.utils` mas tem shims defensivos.
- Se algum módulo falhar, app continua funcionando (sem ícones, sem categoria, mas sem crash).

### Sem framework
- Não há React, Vue, jQuery.
- DOM direto via `document.getElementById`.
- Templates como string literals.

### Acessibilidade
- ARIA labels em botões dinâmicos.
- `prefers-reduced-motion` respeitado.
- Tap targets mínimos 40px em mobile.
- Atalhos de teclado (`/` foca busca, `g+letra` navega).

### Privacidade
- Sem analytics.
- Sem cookies de tracking.
- Watchlist em `localStorage` apenas.
- Tokens da API em `private/tokens/` (fora do deploy).

---

## 9. Testes

```bash
npm install              # primeira vez
npx playwright install   # primeira vez (baixa Chromium)

npm run validate:data    # valida manifest, chunks e sanidade dos dados
npm test                 # roda 41 testes em ~1min
npm run release          # valida dados + testes + zip limpo + valida pacote
npm run test:headed      # vê o browser executando
npm run test:ui          # modo interativo Playwright UI
npm run test:report      # vê relatório HTML do último run
```

**Cobertura:**
- 9 páginas × 3 verificações (abre, título, bloco principal)
- Navegação completa
- Filtros básicos (contratos, emendas)
- Busca de contrato por número com modal de fonte oficial
- Placar do dinheiro
- Aba Diárias (regressão)
- Watchlist vazio

**O que NÃO cobre:**
- Validação de valores específicos dos dados (mudam a cada coleta).
- Snapshot visual.
- Performance.

---

## 10. Limites conhecidos

- **`app.js` ainda monolítico** (5677 linhas). Refactor incremental em curso (fases 3-5 pendentes: dossiê, renderizações de Prefeitura/Câmara/Relatórios/Pessoal).
- **`style.css` único** (5000+ linhas). Plano: dividir em `css/base.css`, `css/components.css`, `css/pages/*.css`.
- **Sem schemas dos JSONs.** Coletor pode produzir JSON inválido que quebra o painel silenciosamente. Plano: validação Pydantic no coletor.
- **Coleta automatizável.** `scripts/update-data.ps1` executa coleta, validação, testes e pacote limpo; `scripts/install-data-task.ps1` registra a rotina diária ou em modo vigia no Windows Task Scheduler.

Veja `docs/como-atualizar.md` para o processo atual de coleta.
