# Testes — Fiscaliza Varginha

## Comandos

```powershell
npm ci
npx playwright install chromium
npm run data:bundle
npm run test:pipeline
npm run test:contracts
npm run test:security
npm test
```

- `test:pipeline`: testes Python dos coletores, preservação de bases, cálculos e schemas.
- `test:contracts`: preservação dos campos nas projeções, procedência das datas e detecção de dependências ausentes no pacote. Requer `prefeitura_painel.json`, gerado por `npm run data:bundle`.
- `test:security`: regressões de XSS do chat e contrato do proxy.
- `npm test`: suíte Playwright, incluindo cálculos, navegação HTTP, filtros, carregamento progressivo e layouts.
- `test:numeros`: correspondência entre valores publicados e fontes locais.

A quantidade de testes evolui. Consulte `npx playwright test --list` e o resultado do unittest, em vez de manter uma contagem fixa neste documento.

## Testar o pacote real

```powershell
npm run deploy:zip
npm run validate:deploy
```

`validate:deploy` confere inventário, dependências, hashes e igualdade entre ZIP e diretório de preparação. Em seguida, `test:deploy` serve esse diretório em uma porta separada e verifica Conformidade, fonte Inter, instalação do cache offline e Pessoal. Isso detecta arquivos presentes no desenvolvimento, mas esquecidos no empacotamento.

Um pacote candidato pode usar `FISCALIZA_DEPLOY_DIR=dist/revisao`, conforme [como-publicar.md](../docs/como-publicar.md).

## Isolar de uma coleta em andamento

A suíte principal usa a porta 4173 por padrão. Para uma execução independente:

```powershell
$env:FISCALIZA_TEST_PORT = "4193"
npm test
Remove-Item Env:FISCALIZA_TEST_PORT
```

`FISCALIZA_TEST_ROOT` permite servir um diretório de preparação. Os testes que leem arquivos diretamente continuam usando os caminhos declarados nos próprios testes. O pacote usa a porta 4184, configurável por `FISCALIZA_DEPLOY_TEST_PORT`, e exige um servidor novo para evitar testar outra versão por engano.

Os comandos npm iniciam um servidor próprio e o encerram diretamente ao terminar. Uma porta ocupada interrompe a execução, evitando validar uma pasta diferente ou encerrar o servidor de outra tarefa. Não contorne uma falha de integridade aumentando o timeout ou removendo uma asserção.

## Cobertura e limites

As regressões de carregamento simulam fontes atrasadas e indisponíveis, verificam que a página fica utilizável antes das publicações pesadas e preservam os registros da fonte disponível. A folha apresenta tentativa novamente quando a requisição falha.

Testes do navegador local não executam PHP nem `.htaccess`. Não comprovam conformidade integral de acessibilidade, disponibilidade atual das APIs externas ou correspondência da hospedagem com a versão local. O CI em `.github/workflows/ci.yml` cobre verificações estáticas, integridade e coletores; o release local inclui a suíte visual e o pacote.
