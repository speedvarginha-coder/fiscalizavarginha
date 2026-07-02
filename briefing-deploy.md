# Briefing para deploy do Fiscaliza Varginha

> Para: Claude / Codex
> De: Mavis (Mavis)
> Data: 27/06/2026
> Objetivo: Reformular visualmente e/ou republicar o painel cidadão em `fiscalizavarginha.com.br`

---

## 1. O que é o projeto

Painel cidadão de **transparência pública** do município de **Varginha-MG**.
Mostra dados de:
- **Prefeitura** (despesas, contratos, licitações, dispensas, diárias, frota, obras)
- **Câmara Municipal** (vereadores, emendas, proposições, votações, contratos Betha)
- **Fundação Cultural de Varginha** (contratos, servidores, despesas)
- **Transferências federais / PNCP / Diário Oficial**

Público-alvo: cidadão comum + jornalistas + vereadores de oposição + Ministério Público.

---

## 2. Estado ATUAL do servidor (importante!)

**Domínio:** `fiscalizavarginha.com.br` (Hostinger)
**Servidor:** srv542-files.hstgr.io (acesso via File Manager do hPanel)
**Caminho do site:** `public_html/`

### Estrutura atual (errada):
```
public_html/
├── padrão.php           ← default da Hostinger, NÃO MEXER
└── painel-cidadao/
    └── painel-cidadao/   ← DUPLICAÇÃO (deve virar painel-cidadao/ direto ou remover o nível extra)
        ├── dados/        ← pasta com chunks JSON (renomeada, era pra ser "data/")
        ├── app.js        (388 KB)
        ├── bate-papo.php (32 KB) ← ⚠️ CRÍTICO — ver seção 3
        ├── data-loader.js
        └── relatorios.html
```

### Versão deployada no servidor:
- Deploy parcial antigo (8 dias atrás)
- **Não tem** todas as páginas (faltam: index.html, fundacao.html, prefeitura.html, etc na raiz)
- **Não tem** módulos JS (15 arquivos)
- **Não tem** sw.js (service worker)
- **Não tem** .htaccess

---

## 3. ⚠️ ARQUIVO CRÍTICO — `bate-papo.php`

**Tamanho:** 32.768 bytes (~32 KB)
**Localização servidor:** `public_html/painel-cidadao/painel-cidadao/bate-papo.php`
**Conteúdo:** contém a chave da API Gemini **obfuscada/codificada**, gerada a partir do `chat.php` local via `encode_deploy.js`

### Regras inegociáveis:
- ❌ **NUNCA sobrescrever** este arquivo
- ❌ **NUNCA substituir** pelo `chat.php` local (esse tem a chave em texto plano)
- ❌ **NUNCA deletar** antes de fazer backup
- ✅ **SEMPRE** baixar backup local antes de qualquer deploy
- ✅ Local de backup esperado: `C:\Users\Desktop\Desktop\Ações Prefeitura Varginha\3_Fiscaliza Varginha\backups-hostinger\bate-papo.php`

### O que ele faz:
Endpoint PHP que recebe requisições do chat "Pergunte à Iris" no frontend, chama a API Gemini server-side, e retorna a resposta. **A chave da API NUNCA vai pro frontend** — vai só do PHP pra Google.

---

## 4. Fontes locais do projeto

### Working tree (fonte):
```
C:\Users\Desktop\Desktop\Ações Prefeitura Varginha\3_Fiscaliza Varginha\
├── painel-cidadao\        ← código-fonte do site
│   ├── *.html             (10 páginas)
│   ├── app.js             (414 KB, atualizado 27/06 09:52)
│   ├── data-loader.js     (8,7 KB, atualizado 27/06 09:55)
│   ├── sw.js              (service worker, 4,7 KB)
│   ├── style.css          (280 KB)
│   ├── chat.php           (36 KB — NÃO USAR NO SERVIDOR, tem chave em texto plano)
│   ├── encode_deploy.js   (script que obfusca o chat.php → bate-papo.php)
│   ├── modules\           (15 JS modules)
│   ├── data\
│   │   ├── manifest.json
│   │   ├── chunks\        (29 JSON)
│   │   └── snapshots\     (30 backups históricos)
│   ├── coletor.py + outros .py (coletores — não vão pro deploy)
│   └── ...
├── dist\
│   └── fiscaliza-varginha-painel.zip  (5,8 MB, 95 arquivos, gerado 27/06 11:05)
└── backups-hostinger\     ← onde os backups do servidor vão
```

### Zip pronto pra deploy:
**Caminho:** `C:\Users\Desktop\Desktop\Ações Prefeitura Varginha\3_Fiscaliza Varginha\dist\fiscaliza-varginha-painel.zip`
**Tamanho:** 5,8 MB
**Conteúdo:** 95 arquivos (HTMLs, JS, CSS, .htaccess, data/, modules/, manifest.json)
**Quando foi gerado:** 27/06/2026 às 11:05

---

## 5. Páginas e arquitetura

### 10 páginas HTML (no zip):
| Página | Rota | Função |
|---|---|---|
| `index.html` | `/` | Home com cards-resumo |
| `camara.html` | `/camara.html` | Vereadores, emendas, votações |
| `prefeitura.html` | `/prefeitura.html` | Despesas, contratos, licitações |
| `fundacao.html` | `/fundacao.html` | Fundação Cultural (NOVO) |
| `cobrar.html` | `/cobrar.html` | Lista de "promessas vs realizado" |
| `pessoal.html` | `/pessoal.html` | Servidores, salários |
| `atualizacoes.html` | `/atualizacoes.html` | Histórico de mudanças |
| `relatorios.html` | `/relatorios.html` | Relatórios temáticos |
| `marcadores.html` | `/marcadores.html` | Watchlist do usuário |
| `sobre.html` | `/sobre.html` | Sobre o projeto |

### Stack JS:
- **Vanilla JS** (sem React/Vue/framework)
- **Módulos ES6** em `modules/`
- **Service Worker** (`sw.js`) pra cache offline
- **CSS próprio** (`style.css` + `style.min.css`)
- **Sem build step** — arquivos prontos pra servir

### Módulos JS (15):
atualizacoes, categorias, chat-cidadao, dashboard, diarias, dossie, glossario, home-cidadao, icons, indice-relevancia, materia-cidada, onboarding, relatorios, utils, watchlist

---

## 6. Dados — onde está o quê

### Coletores Python (não vão pro deploy):
Localização: `painel-cidadao/*.py`
Função: fazem scraping dos portais e geram os chunks JSON

**4 portais cobertos:**
1. **Betha Prefeitura** — hash `y7mn01LGqd_HCvGtj6VPwA==`
2. **Betha Câmara** — hash `-iAWLe1kr2VQcrW9k2AUBg==`
3. **Câmara SAPL** — `sapl.varginha.mg.leg.br/api/...`
4. **Betha Fundação Cultural** — hash `Y3P0PCFbAxmzg0qvgnMnYw==`

O token Betha é capturado via Playwright e reusado entre portais.

### Chunks JSON (29 arquivos em `data/chunks/`):
- `resumo.json` — KPIs gerais
- `prefeitura.json` (4,8 MB) — despesas + contratos prefeitura
- `camara_anos.json` (1,8 MB) — histórico da câmara
- `camara_betha.json` — contratos/licitações Betha da câmara
- `camara_transparencia.json` — vereadores, proposições
- `vereadores.json` — lista dos 13 vereadores ativos
- `remuneracao_vereadores.json` — salários
- `emendas.json` — emendas parlamentares
- `fundacao_cultural.json` (1,2 MB) — Fundação (NOVO)
- `pessoal.json` (2,4 MB) — servidores
- `diarias.json` (3,8 MB) — diárias
- `licitacoes.json` — licitações
- `federal.json` — transferências federais
- `pncp.json` — PNCP
- `auditoria_dados.json` — controle de qualidade
- `indice_relevancia.json` — relevância das matérias
- `mudancas_coleta.json` — log de mudanças
- E mais ~12 outros

### Snapshots (`data/snapshots/`):
30 backups históricos. O frontend usa pra gráfico "viajou no tempo".

---

## 7. Recursos e limitações do servidor

| Recurso | Limite | Uso atual |
|---|---|---|
| Disco | 50 GB | 7,6 GB (15,19%) |
| Inodes | 600.000 | 134.687 (22,45%) |
| SSL | ativo ✓ | — |
| Proteção malware | ativo ✓ | — |
| Git deploy | não testado (talvez não tenha) | — |
| FTP/SFTP | disponível | sim |

### URL do File Manager:
`https://srv542-files.hstgr.io/Se2956e6c0c37e50/files/`

---

## 8. Como republicar (Opção A — limpa total)

### Passo a passo:

**1. Backup do `bate-papo.php`**
- Acessar File Manager → `public_html/painel-cidadao/painel-cidadao/bate-papo.php`
- Botão direito → Download (ou abrir e salvar manualmente)
- Salvar em `C:\Users\Desktop\Desktop\Ações Prefeitura Varginha\3_Fiscaliza Varginha\backups-hostinger\`
- Validar: tamanho ~32 KB

**2. Apagar estrutura errada**
- Navegar até `public_html/`
- Selecionar pasta `painel-cidadao/` → Delete
- NÃO mexer em `padrão.php` (default Hostinger)

**3. Subir zip novo**
- Em `public_html/` (agora vazio, só com `padrão.php`)
- Upload do `fiscaliza-varginha-painel.zip` (5,8 MB)
- Extrair no mesmo lugar (`public_html/`)
- Deletar o .zip depois

**4. Reupar `bate-papo.php`**
- Upload do backup `bate-papo.php` pra raiz `public_html/`

**5. Testar**
- `https://fiscalizavarginha.com.br/` → home
- `https://fiscalizavarginha.com.br/fundacao.html` → Fundação
- `https://fiscalizavarginha.com.br/camara.html` → Câmara
- Chat "Iris" → deve responder (bate-papo.php funciona)
- `Ctrl+Shift+R` pra forçar reload sem cache

---

## 9. Pontos de atenção pra reformulação visual

Se vocês forem redesenhar o site, mantenham:

- ✅ As **10 páginas HTML** (estrutura e URLs)
- ✅ O **sistema de chunks** (`data/chunks/*.json`) — não embutir tudo num JS monolítico
- ✅ O **service worker** (`sw.js`) — atualizem o cache version quando mudarem assets
- ✅ O **`.htaccess`** — tem regras de SPA fallback (rotas amigáveis)
- ✅ A **estrutura modular** (`modules/*.js`) — não amontoar tudo no `app.js`
- ✅ Compatibilidade com **tema escuro/claro**
- ✅ Acessibilidade (`aria-*`, contraste WCAG AA)
- ✅ Responsivo (mobile-first)
- ✅ SEO (`sitemap.xml`, `robots.txt`, meta tags)

### Pra atualizar a coleta de dados:
- Rodar `painel-cidadao/coletor.py` localmente
- Atualiza os chunks em `painel-cidadao/data/chunks/`
- Rezipar e republicar

### Sobre o `bate-papo.php`:
Se vocês reescreverem o endpoint Gemini, **gerem o novo via `encode_deploy.js`**:
```bash
node encode_deploy.js chat.php > bate-papo.php
```
Nunca subam `chat.php` cru pro servidor.

---

## 10. Contatos úteis

- **Coleta:** `coletor.py` (script Python principal) + 13 coletores auxiliares
- **Validação:** `py_compile coletor.py && validate:data` (script npm)
- **Último commit:** `088b978 fix(vereadores): usa PARLAMENTARES_MONITORADOS no resumo SAPL`
- **Última coleta:** 26/06/2026 às 14:49
- **Último deploy parcial:** 27/06/2026 às ~12:00 (parcial, só 5 arquivos)

---

## 11. TL;DR (pra ler em 30 segundos)

1. **Backup crítico:** `bate-papo.php` (32 KB, chave Gemini obfuscada)
2. **Servidor:** `public_html/` no Hostinger, estrutura atual tá duplicada
3. **Zip pronto:** `dist/fiscaliza-varginha-painel.zip` (5,8 MB, 95 arquivos)
4. **Fonte local:** `painel-cidadao/` no PC do usuário
5. **4 portais Betha** + SAPL já estão integrados nos chunks
6. **10 páginas HTML** + 15 módulos JS + 29 chunks JSON
7. **Foco da reformulação:** visual novo, mantendo estrutura funcional

---

*Documento gerado em 27/06/2026 pelo Mavis pra handoff com Claude/Codex.*