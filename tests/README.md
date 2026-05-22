# Testes — Fiscaliza Varginha

Smoke tests em Playwright para garantir que cada página HTML abre, executa
`app.js` sem erro crítico, e renderiza pelo menos um bloco principal.

## Por que existem

Antes destes testes, refatorar o código (especialmente correções massivas em
strings, como o fix de português que aconteceu) podia quebrar identifiers JS
sem ninguém perceber até o usuário ver alerta vermelho.

Estes testes pegam:
- `ReferenceError` (variável não definida)
- `TypeError` (chamada em valor undefined)
- Blocos principais sumindo
- Filtros não respondendo
- `data.js` não carregando

## Como rodar

```bash
# Instalar Playwright (uma vez):
npm install
npx playwright install chromium

# Rodar todos os testes:
npm test

# Modo visual (vê o browser executando):
npm run test:headed

# Modo UI interativo (Playwright Test UI):
npm run test:ui

# Ver relatório HTML do último run:
npm run test:report
```

## O que cobre

| Categoria | Testes |
|-----------|--------|
| Smoke por página | 8 páginas × 3 verificações (abre, título, bloco principal) |
| Navegação | Nav contém todos os links |
| Filtros básicos | Busca em contratos e emendas aceita texto |
| Placar | 4 cards renderizados em Prefeitura e Câmara |
| Watchlist | Estado vazio aparece em marcadores sem localStorage |

Total: ~31 testes.

## O que NÃO cobre (intencional)

- Validação dos VALORES dos dados — testes não devem depender de números
  específicos que mudam a cada coleta.
- Snapshot visual — pode ser adicionado depois com `toMatchSnapshot()`.
- Acessibilidade automática — vale rodar `axe-core` em sessão separada.
- Performance — Lighthouse é melhor ferramenta.

## Próximos passos sugeridos

1. Rodar localmente após cada PR.
2. Quando hospedar o painel, configurar GitHub Actions para rodar em push.
3. Adicionar testes de regressão visual nos cards do placar.
