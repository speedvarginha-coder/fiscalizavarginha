# Scripts — Fiscaliza Varginha

## `scrape-betha.mjs`

Coleta dados reais do **Portal da Transparência Betha** da Prefeitura e da
Câmara Municipal de Varginha, e grava em `src/data/categoriasGasto.real.json`.

A interface mostra com selo verde "✓ Dado real auditado" e a fonte (URL)
todas as categorias que tiverem entrada nesse JSON. Categorias sem dado real
caem na estimativa marcada como "≈ Estimativa".

### Como rodar

A partir da pasta raiz do projeto (`3_Fiscaliza Varginha/`):

```bash
# Todas as categorias, Prefeitura + Câmara
node dashboard/scripts/scrape-betha.mjs

# Só uma categoria por função (depuração)
node dashboard/scripts/scrape-betha.mjs --funcao Saúde

# Só uma categoria por elemento (depuração)
node dashboard/scripts/scrape-betha.mjs --elemento "Combustíveis Automotivos"

# Modo dry-run (não grava, só mostra o resultado)
node dashboard/scripts/scrape-betha.mjs --dry
```

### Pré-requisitos

- Node.js 18+
- `playwright` instalado (já está no `package.json` da raiz)

### Como funciona (API direta, não UI)

O script **não** clica na interface do portal. Ele:

1. Abre o portal Betha uma vez com Playwright (`headless: true`) só para
   **capturar o token OAuth** (`Authorization: Bearer …`) das requisições.
2. Chama a **API REST** do Betha diretamente
   (`api.transparencia.betha.cloud`), que é muito mais rápida e confiável que
   manipular a SPA Vue.

Endpoints usados (descobertos por inspeção de rede):

- `POST /busca-textual/{consultaId}/totalizadores` — soma por filtro
- `POST /busca-textual/{consultaId}?…&limit=1` — contagem (`totalHits`)
- Header obrigatório `app-context: base64({"portal": HASH})` por entidade

IDs de consulta confirmados:

| Consulta | ID |
|---|---|
| Prefeitura — Execução de Despesas | `82995` |
| Câmara — Execução de Despesas | `324767` |
| Câmara — Diárias (consulta dedicada) | `324755` |
| Câmara — Licitações | `324786` |
| Câmara — Contratos | `324812` |

> **Listas de registros individuais** (diárias, licitações, contratos) são
> gravadas em `categoriasGasto.real.json`:
> - Diárias: em `dados.camara.diarias.registros`
> - Licitações/contratos: em `listas.camara.{licitacoes,contratos}.registros`
>
> Cada lista guarda no máximo `LIMITE_REGISTROS_LISTA` (200) registros,
> ordenados por valor desc, para não inchar o bundle. O campo `totalHits`
> mostra o total real; `mostrando` quantos foram persistidos.

> A consulta de **Diárias da Câmara** (`324755`) usa schema diferente: filtra
> por campo `ano` (não `anoExercicio`) e **não tem totalizadores** — o script
> soma `valorTotal` dos registros client-side em `scrapeDiariasCamara()`.

### Por que API e não UI?

A maioria dos municípios usa Betha (ou Implanta, e-Cidades, TecnoSim) com
transparência via SPA, **sem API pública documentada**. Mas a API interna
existe e responde com o token capturado do próprio portal. A Lei 12.527/2011
garante o direito de acesso, então a coleta é legítima.

### Agendamento — Task Scheduler (Windows)

Já há uma tarefa registrada que roda o scraper **toda segunda às 06:17**:

- **Nome:** `FiscalizaVarginha-AtualizarDados`
- **Wrapper:** `scripts/atualizar-dados.bat` (grava log em
  `scripts/atualizar-dados.log`)

Gerenciar a tarefa:

```powershell
# Ver status / próxima execução
schtasks /Query /TN "FiscalizaVarginha-AtualizarDados" /FO LIST

# Rodar agora (teste)
schtasks /Run /TN "FiscalizaVarginha-AtualizarDados"

# Remover o agendamento
schtasks /Delete /TN "FiscalizaVarginha-AtualizarDados" /F
```

No Linux/macOS, use cron:
```cron
17 6 * * 1 cd /caminho/para/3_Fiscaliza\ Varginha/dashboard && node scripts/scrape-betha.mjs
```

### Política de integridade

- **NUNCA** invente valores. Se o seletor falha, o script deve REGISTRAR
  o erro e PULAR — nunca gravar um número aproximado como se fosse real.
- Cada entrada em `categoriasGasto.real.json` precisa ter `fonteUrl` válido
  apontando para a consulta que produziu aquele número.
- O selo verde "✓ Dado real" só aparece se o JSON tiver a entrada — o
  default é "≈ Estimativa" com aviso amarelo.

Sem isso, a plataforma vira um vetor de acusação injusta. Dado errado é pior
que dado faltando.
