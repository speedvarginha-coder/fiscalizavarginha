# Dados de emendas

O painel separa esfera, origem e estágio financeiro. Um valor indicado ou
utilizado nunca é promovido automaticamente a pagamento, recebimento ou
execução.

## Emendas estaduais

Fonte primária:

- Página oficial: https://www.emendas.mg.gov.br/transparencia/
- Sistemas declarados pelo Estado: SIGCON-MG, SIAFI-MG e SIAD-MG.
- Recorte municipal: código IBGE `3170701` (Varginha).

Atualização:

```powershell
python coletor_emendas_estaduais.py
```

O coletor descobre o XLSX consolidado mais recente, valida as colunas, calcula
o SHA-256, preserva uma cópia em `private/cache/emendas-estaduais/` e gera
`data/emendas_estaduais_normalizadas.js`.

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
