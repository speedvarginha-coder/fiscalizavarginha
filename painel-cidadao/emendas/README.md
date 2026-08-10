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
