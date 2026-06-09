# Manifesto de revisão — snapshot do Codex (`ef7d9f3`)

> O commit `ef7d9f3` capturou **94 arquivos** (22 add, 15 del, 57 mod) de uma vez,
> para proteger o trabalho do Codex antes de qualquer melhoria. Este documento o
> quebra em **fatias revisáveis** para conferência slice-a-slice — sem reescrever
> o histórico (rebase interativo não roda no ambiente e o commit está soterrado
> por trabalho posterior já testado em 54/54).
>
> Estado verificado no momento do snapshot: `lint:syntax` 17/17, smoke 54/54.
> Marque cada fatia ao revisar. ⚠️ = exige decisão humana.

---

## Fatia 1 — Feature: Fila de Cobrança  ✅ verificada (renderiza, 28 cards, 0 erro console)
- `painel-cidadao/cobrar.html` (bloco `#filaCobranca` + filtros)
- `painel-cidadao/app.js` (lógica de montagem da fila/semáforo)
- `painel-cidadao/data-loader.js` (carrega diário, pessoal, remuneração na página cobrar)
- **Revisar:** copy (acentos já corrigidos em `fa8eb55`), semáforo coerente com risco.

## Fatia 2 — Nova camada de qualidade de dados  ✅ em uso (selo de saúde já consome)
- `scripts/audit-data-quality.mjs`, `scripts/generate-data-snapshots.mjs`,
  `scripts/check-source-updates.mjs`, `scripts/sync-data-bundle.mjs`,
  `scripts/generate-indice-relevancia.mjs`
- `painel-cidadao/modules/indice-relevancia.js`
- chunks: `auditoria_dados.json`, `indice_relevancia.json`, `mudancas_coleta.json`
- `painel-cidadao/data/snapshots/*` (5 snapshots)
- **Revisar:** os snapshots são artefatos — avaliar se devem ser versionados ou ignorados.

## Fatia 3 — Novos chunks de dados  ⚠️ conferir autenticidade
- `painel-cidadao/data/chunks/remuneracao_vereadores.json`
- `painel-cidadao/data/chunks/sancoes_fornecedores.json`
- **Revisar:** fonte real (lei/legislatura; CEIS/CNEP), sem dado fabricado. Spot-check feito: sem marcadores de placeholder.

## Fatia 4 — Coletor expandido
- `painel-cidadao/coletor.py`, `painel-cidadao/coletor_betha.py`
- **Revisar:** novas consultas (frota, obras), e o fix de `execucao_direta` (commit `97c818a`).

## Fatia 5 — Dados regenerados  ⚠️ conferir autenticidade (só dado real Varginha)
- chunks modificados: `prefeitura.json` (+107k), `pessoal.json` (+90k), `diarias.json`,
  `diario.json`, `cnpjs.json`, `federal.json`, `fontes_emendas_2026.json`, `pncp.json`,
  `manifest.json`, `atualizado_em.json`
- **Revisar:** valores batem com portais oficiais; rede de invariantes (`tests/calculos.spec.js`) cobre parte.

## Fatia 6 — Módulos do painel (edições)
- `painel-cidadao/modules/`: `atualizacoes.js` (+809), `categorias.js`, `dashboard.js`,
  `diarias.js`, `dossie.js`, `glossario.js`, `materia-cidada.js`; `app-glossario.js`
- **Revisar:** lógica de render; sem regressão (smoke cobre superfície).

## Fatia 7 — HTML/UI das páginas
- `index.html`, `atualizacoes.html`, `camara.html`, `marcadores.html`, `pessoal.html`,
  `prefeitura.html`, `relatorios.html`, `sobre.html`, `style.css`, `sw.js`, `.htaccess`
- **Revisar:** layout/copy; selo de saúde já adicionado por cima (`f0923c8`, `53ef8da`, `3fed6b5`).

## Fatia 8 — Dashboard React (sub-app)  ⚠️⚠️ DELEÇÕES — confirmar intenção
- **Deletados:** `src/office/*` (Phaser: AgentSprite, OfficeScene, PhaserGame, RoomBuilder,
  assetKeys, palette), `src/plugin/squadWatcher.ts`, `src/store/useSquadStore.ts`,
  `src/hooks/useSquadSocket.ts`, `src/lib/formatTime.ts`, `src/types/state.ts`,
  `src/components/SquadCard|SquadSelector|StatusBadge|StatusBar.tsx`
- **Modificados:** `components/citizen/*`, `data/*`, `vite.config.ts`, `styles/globals.css`
- **Revisar:** o `dashboard/` é sub-app separado (não é o painel público). As deleções
  parecem remoção da visualização "squad office" (não-cívica). **Confirmar que foi intencional.**

## Fatia 9 — Pipeline/release
- `scripts/install-data-task.ps1`, `scripts/package-deploy.ps1`, `scripts/update-data.ps1`,
  `scripts/validate-release.mjs`
- **Revisar:** agendamento e empacotamento; `validate-release` cobre data+deploy.

## Fatia 10 — Docs
- `README.md`, `docs/arquitetura.md`, `docs/automacao-de-dados.md`, `docs/fontes-de-dados.md`

## Fatia 11 — Testes
- `tests/smoke.spec.js` (+266; novos testes de selo de confiança, Diário Oficial, dossiê)
- **Revisar:** asserts batem com a UI (1 ajuste de acento feito em `fa8eb55`).

## Fatia 12 — Config pessoal / artefatos  ⚠️ considerar remover do versionamento
- `.claude/launch.json`, `.claude/settings.local.json`, `_opensquad/_memory/company.md`,
  `dashboard/tsconfig.tsbuildinfo`, `dashboard/package-lock.json`
- **Revisar:** não são código do produto; avaliar `.gitignore`.

---

### Como usar
1. Revise fatia a fatia: `git show ef7d9f3 -- <arquivo>` para ver o diff de cada um.
2. Priorize as ⚠️: Fatia 8 (deleções dashboard), Fatias 3 e 5 (autenticidade de dados).
3. O que já foi endereçado por commits posteriores está anotado na fatia.
