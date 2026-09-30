# Dados de emendas

O painel separa esfera, origem e estágio financeiro. Um valor indicado ou
utilizado nunca é promovido automaticamente a pagamento, recebimento ou
execução.

## Emendas estaduais

Fonte primária:

- Página oficial: https://www.emendas.mg.gov.br/transparencia/
- Relatório complementar de 2026: https://www.emendas.mg.gov.br/2026-2/
- Sistemas declarados pelo Estado: SIGCON-MG, SIAFI-MG e SIAD-MG.
- Recorte municipal: código IBGE `3170701` na base consolidada e nome Varginha no relatório de 2026.

Atualização:

```powershell
python coletor_emendas_estaduais.py
```

O coletor descobre o XLSX consolidado e o relatório de indicações aptas de
2026. Para as mesmas indicações, os valores financeiros mais recentes do
relatório de 2026 substituem os da base consolidada sem somar registros duas
vezes. A indicação rejeitada, ausente da lista de aptas, permanece identificada.
Ambos os arquivos têm SHA-256 e cópia em `private/cache/emendas-estaduais/`.
A saída é `data/emendas_estaduais_normalizadas.js`.

Os seguintes valores permanecem separados:

- indicado;
- utilizado/associado à indicação;
- empenhado;
- liquidado;
- pago;
- executado;
- restos a pagar.

`Valor Utilizado` é um estágio administrativo da indicação e não comprova
pagamento. `Valor Pago Atualizado` é a única coluna usada como pagamento.
Mesmo quando há pagamento oficial, o painel não afirma que o beneficiário
executou o objeto sem uma evidência específica de execução.

Se a fonte estiver temporariamente indisponível e já houver uma base válida, o
coletor retorna código `2` e preserva o arquivo anterior. O pipeline aceita esse
código como atualização degradada; ausência de base anterior continua sendo
falha bloqueante.

## Auditoria

```powershell
python audit_emendas.py
python -m unittest discover -s ../../tests -p "test_*.py"
npx playwright test ../../tests/emendas-audit.spec.js
```

O arquivo publicado inclui URL oficial, data de coleta, planilha/linha original
e SHA-256 do XLSX para permitir reprodução e conferência.

## Emendas federais e transferências especiais

A relação agregada de emendas/favorecidos continua vindo do conjunto aberto
do Portal da Transparência (CGU). As transferências especiais destinadas ao
Município usam adicionalmente a API pública do Transferegov, filtrada pelo CNPJ
exato `18.240.119/0001-05`.

O enriquecimento segue a cadeia de chaves oficiais:

`beneficiário -> plano de ação -> empenho -> documento hábil -> ordem bancária -> conta vinculada`

Regras bloqueantes:

- parâmetros desconhecidos da API são rejeitados antes da consulta;
- todo registro retornado deve repetir a chave de relacionamento solicitada;
- a mesma emenda em plano impedido e posteriormente reprocessado é contada uma
  vez, mantendo o plano impedido no histórico;
- ordem bancária comprova a transferência federal, mas recebimento só é marcado
  quando há crédito correspondente na conta vinculada;
- saldo bancário é apenas informativo e nunca vira valor recebido ou executado;
- valor executado permanece `N/D` enquanto não existir relatório de gestão
  específico na API.

Atualização:

```powershell
python coletor_emendas_federais.py
```
