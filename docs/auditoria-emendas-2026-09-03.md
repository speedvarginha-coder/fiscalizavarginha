# Conferência das emendas publicadas em 03/09/2026

**Registro da situação anterior às correções.** O reprocessamento de 04/09/2026 corrigiu anos, seleção do recorte federal, leitura de valores municipais e identificação documental. Os totais abaixo descrevem a base anterior; os resultados atuais e as limitações preservadas estão em [Revisão de qualidade de 04/09/2026](revisao-qualidade-2026-09-04.md).

## Escopo e resultados confirmados

- Os cinco arquivos de dados de `/emendas/` em produção são idênticos, por SHA-256, ao pacote publicado nesta data.
- A base municipal contém 581 registros, sendo 224 históricos do Betha e 357 do SAPL. A auditoria de número/ano não encontrou duplicatas. O total indicado é R$ 32.307.869,18; não representa pagamento comprovado.
- Os 210 registros estaduais totalizam R$ 31.662.058,85 indicados e R$ 23.213.779,79 pagos segundo as colunas da fonte. A contagem e os três totais de indicação, empenho e pagamento foram recalculados diretamente no XLSX baixado hoje da ALMG. Recebimento pelo beneficiário permanece separado.
- Os 96 registros federais provenientes da CGU somam R$ 22.695.441,99. A comparação por código, favorecido, valor e multiplicidade coincide com o arquivo oficial em cache coletado hoje. As seis referências adicionais do Betha não acrescentam valor a essa soma.
- O teste estrutural existente passou. Isso não detectou os problemas de ano descritos abaixo e não equivale a uma auditoria documental de cada emenda.

## Achados

### 1. Ano incorreto em 32 registros federais

O coletor copia o campo `Ano/Mês` do arquivo `EmendasParlamentares_PorFavorecido.csv` para `anoEmenda`. Porém, o arquivo principal `EmendasParlamentares.csv` possui um campo próprio, `Ano da Emenda`.

Exemplo: o registro da emenda `202314110006`, de R$ 1.062,01, aparece com `anoEmenda: 2024`; a CGU informa ano da emenda 2023. A divergência foi confirmada em 32 registros com código identificador válido. Eles não equivalem necessariamente a 32 emendas distintas.

**Impacto:** filtros, contagens e rankings por ano da emenda podem atribuir recursos ao período errado, mesmo com o total geral correto.

**Correção necessária:** obter o ano da emenda na tabela principal por código e manter o período de recebimento em campo separado; validar os dois campos contra suas fontes.

### 2. O exercício orçamentário municipal não está representado no filtro

O PDF oficial da emenda `004/2025`, de R$ 30.000,00 para a Polícia Civil, identifica o Projeto de Lei nº 57/2025 e o **orçamento para 2026**. O registro publicado possui ano da emenda 2025 e não identifica seu exercício orçamentário.

No site, a combinação Municipal + ano 2026 retorna zero resultados. Isso não comprova ausência de destinações ao orçamento de 2026. A consulta SAPL por matérias numeradas em 2026 também retornou zero, mas consulta ano de apresentação, não exercício do orçamento.

**Correção necessária:** separar número/ano da proposição, exercício orçamentário e ano do recurso. A associação ao exercício deve ser comprovada documentalmente, sem presumir que todo registro pertence ao ano seguinte.

### 3. Identificação incompleta de beneficiários municipais

Há cinco CNPJs marcados como inválidos e 43 registros sem CNPJ na união municipal. Exemplos inválidos: `004/2025`, `008/2025`, `121/2025`, `122/2025` e `148/2025`.

**Impacto:** vínculos automáticos com beneficiários e pagamentos exigem ressalva. Os números devem ser conferidos nos documentos e cadastros oficiais; não cabe completar dígitos por suposição.

### 4. Atualidade e divergências das fontes

- O XLSX disponibilizado hoje pela ALMG é a planilha `12-05-2026`, com última modificação em 21/05/2026. Seu hash coincide com o arquivo usado pelo site. A coleta em setembro não comprova execução atualizada até setembro.
- A indicação estadual `159644/2025` tem divergência em **valor utilizado**: R$ 0 no Portal Emendas MG e R$ 100.000 na ALMG. Isso não é divergência constatada no valor pago. O registro conserva a sinalização de divergência entre fontes.
- O enriquecimento federal do Transferegov está preservado após erro HTTP 404. A consulta ao endpoint nesta conferência também retornou 404. Os sete recebimentos confirmados na base possuem evidência histórica; não foram revalidados na fonte atual nesta auditoria.
- O cabeçalho do site mostrou `02/09/2026, 21:00` ao interpretar a data federal `2026-09-03` como meia-noite UTC. A apresentação mistura data de coleta e conversão de fuso e precisa ser corrigida.
- Existe ainda uma referência Betha com `ano: 2754`, derivado do código `27540001`. Ela vale zero e não apareceu como opção de ano no filtro, mas constitui um campo inválido na base.

## Fontes e evidências

- [Página de emendas do Fiscaliza Varginha](https://www.fiscalizavarginha.com.br/emendas/)
- [Dados abertos de emendas da CGU](https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares/UNICO)
- [Emendas parlamentares da ALMG](https://www.almg.gov.br/atividade-parlamentar/emendas-parlamentares/inicial/)
- [XLSX disponível na ALMG](https://mediaserver.almg.gov.br/acervo/497/507/2497507.xlsx)
- [PDF oficial da emenda municipal 004/2025](https://sapl.varginha.mg.leg.br/media/sapl/public/materialegislativa/2025/4945/segmento_005_de_projetodelei57-2025_-_emendas.pdf)
- Evidências locais: `tmp/auditoria-emendas-online.json`, `tmp/auditoria-anos-federais.json`, `tmp/auditoria-fontes-emendas.json`, `tmp/auditoria-almg-registros.json` e `tmp/auditoria-recorte-federal.json`.

A prioridade é corrigir os anos e a distinção entre proposição e exercício orçamentário, preservar as ressalvas de atualização e ampliar as validações para que esses erros impeçam novas publicações.
