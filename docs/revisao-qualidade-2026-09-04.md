# Revisão de qualidade de 04/09/2026

## Auditômetro

Os cartões reproduzem a base nacional PNTP 2025 disponibilizada pela Atricon, sem calcular uma nota própria de transparência.

| Órgão de Varginha (IBGE 3170701) | Índice | Essenciais | Nível | Itens atendidos / pendentes |
|---|---:|---:|---|---:|
| Prefeitura | 81,80% | 81,82% | Elevado | 188 / 77 |
| Câmara | 63,28% | 85,71% | Intermediário | 128 / 112 |

Ambos os registros são **autoavaliações**, sem validação, revisão ou condição de certificação registrada na base consultada. Referem-se a 2025 e não são uma avaliação atual de 2026. A metodologia nacional não equivale à contagem simples de itens atendidos.

O arquivo oficial foi publicado em 10/02/2026 e consultado em 03/09/2026. A referência pública mantém URLs, identificadores, datas e hashes. As 509 linhas originais foram agrupadas em 505 itens únicos por critério e item de verificação, preservando os links adicionais de evidência. A interface permite consultar pendências, itens atendidos e pesquisar os critérios. Falha na consulta não zera as notas. Métricas locais de descrição contratual e CNPJ são apresentadas separadamente e não representam certificação.

Fontes: [download oficial Atricon](https://radardatransparencia.atricon.org.br/downloads.html), [arquivo PNTP 2025](https://radardatransparencia.atricon.org.br/dados/dados_pntp_2025.zip), [Prefeitura no Radar Transparente](https://radartransparente.com.br/avaliacao/59f001b0-a3d0-42cb-953b-0d02db067387), [Câmara no Radar Transparente](https://radartransparente.com.br/avaliacao/5518baf1-b161-4f79-b364-94c64e2af7bb).

## Emendas municipais

- 581 registros: 224 históricos Betha e 357 SAPL, sem duplicidade de número/ano. Total indicado de referência: **R$ 32.500.880,29**, incluindo R$ 18.034.380,29 do SAPL. Não representa pagamento comprovado.
- 356 PDFs acessíveis conferidos; um registro sem PDF. O exercício de 2026 foi confirmado em 354 registros. Os PDFs das matérias 317/2025 e 323/2025 informam, respectivamente, números 318 e 324; o exercício permanece não confirmado nesses registros. A matéria 130/2025 não tem PDF informado.
- Cabeçalhos de quatro documentos com OCR incorreto (90, 310, 351 e 352) foram verificados visualmente. A imagem do documento 351 diz 2026, embora a camada de texto reconheça 2025.
- Cinco CNPJs corrigidos com fonte oficial: Polícia Civil, Hospital Regional, Fundação Salvar (duas emendas) e CEFET. Os valores originais e as fontes permanecem nos detalhes. Ainda há 43 registros municipais sem CNPJ, incluindo o histórico. A identificação cadastral não comprova execução da emenda.
- O filtro diferencia ano da proposição, exercício do orçamento e ano do recurso. As datas de coleta são exibidas por fonte, preservando as limitações de atualização.

### Conferência de valores

| Emenda | Valor anterior no painel | Cadastro SAPL | Formulário assinado adotado como referência |
|---|---:|---:|---:|
| 019/2025 | R$ 81.416,21 | R$ 81.416,21 | R$ 131.416,21 |
| 225/2025 | R$ 15.000,00 | R$ 35.000,00 | R$ 35.000,00 |
| 268/2025 | R$ 30.000,00 | R$ 30.000,00 | R$ 22.000,00 |
| 315/2025 | R$ 50.000,00 | R$ 81.011,11 | R$ 81.011,11 |
| 341/2025 | R$ 100.000,00 | R$ 100.000,00 | R$ 200.000,00 |

Nas emendas 225 e 315, um símbolo monetário duplicado na ementa fazia o coletor capturar a parcela de um coautor. O leitor foi corrigido. Nas emendas 19, 268 e 341, há divergência real entre cadastro e PDF: os dois valores são exibidos e a divergência precisa de esclarecimento pelo órgão. A referência documental não é certificação do valor executado.

Participações individualizadas nos documentos 19, 225, 315, 341 e 351 são usadas no ranking do valor indicado. Nos demais registros conjuntos, o rateio é estimativo e explicitado na interface. Não são atribuídas parcelas de pagamento sem comprovação.

A referência pública `data/referencias/emendas-municipais-documentos.json` preserva número, beneficiário, URL, SHA-256 do PDF e as conferências. O enriquecimento só se aplica ao mesmo número/ano, beneficiário e URL, e aos valores originais conhecidos. Mudanças na fonte exigem nova conferência. Associações históricas de pagamentos a beneficiários são preservadas com ressalvas e não se tornam comprovação de pagamento individual.

## Emendas federais

O coletor agora interpreta as colunas da CGU pelo nome. O ano da emenda vem da tabela principal, enquanto o período de recebimento vem da tabela por favorecido. Exemplo: emenda 202314110006, ano da emenda 2023, período de recebimento 10/2024. As 32 classificações temporais incorretas da base anterior foram corrigidas. O código Betha 27540001 não é mais interpretado como ano 2754.

O recorte corrigido contém **98 registros CGU, totalizando R$ 23.370.041,99**, mais seis referências municipais Betha sem acréscimo nessa soma. São 57 códigos CGU individuais identificados; 14 registros sem código individual informado mantêm seus valores, sem receber ano de emenda presumido. O recorte exige Varginha/MG, evitando confusão com São José da Varginha.

Dois registros anteriormente omitidos pelo deslocamento das colunas foram recuperados: 201927920005, R$ 477.500,00, e 201629240025, R$ 197.100,00. Nenhum dos registros anteriores foi descartado. A comparação considera código, favorecido, valor e multiplicidade.

As oito emendas com vínculo Transferegov mantêm as evidências históricas. A última consulta retornou 404; os sete recebimentos antes confirmados não foram revalidados nesta consulta. O site informa essa limitação. A data de coleta CGU não é usada como atualização do Transferegov.

Fonte: [dados abertos CGU](https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares/UNICO).

## Limites mantidos e validação

O arquivo ALMG consultado continua sendo a planilha 12-05-2026, modificada em 21/05/2026. Coleta recente não comprova execução financeira recente. Os 210 registros estaduais e a divergência de valor utilizado na indicação 159644/2025 permanecem identificados. Valores indicados, utilizados, pagos, recebidos e executados continuam separados.

Foram adicionadas verificações de colunas CGU, período e ano, seleção municipal, valores conjuntos, preservação do original, mudança de URL e PDFs divergentes. A verificação no navegador cobre PNTP, recuperação após erro, teclado, filtros orçamentários e financeiros, detalhes documentais e apresentação em celular. O pacote final deve passar também pelo validador de publicação e pelos testes servidos diretamente da pasta de distribuição.

## Publicação concluída

- Publicado em https://www.fiscalizavarginha.com.br/ em 04/09/2026. Pacote: `dist/pntp-final`; identificação gerada às 12:54:39 UTC.
- 142 testes Python, 13 testes de navegador das funcionalidades, oito testes de contratos e quatro testes do pacote aprovados. Validação de dados, sintaxe, acentos, limites de desempenho e ZIP aprovados.
- 128 arquivos conferidos no ZIP. Após a publicação, 15 arquivos críticos foram baixados por HTTPS e comparados por SHA-256 com o pacote; todos coincidiram. Testados online: critérios PNTP, 354 registros do exercício 2026, 227 sem exercício confirmado, detalhes de participação e apresentação em celular. Sem erros JavaScript nessas verificações.
- Recursos JS/CSS e carregamento dinâmico recebem versão própria por publicação, evitando reutilização de scripts antigos pelo cache HTTP. As duas referências documentais públicas foram liberadas no servidor; JSONs intermediários continuam bloqueados.
- A coleta automática que regravava a base durante a revisão foi interrompida. Seus dados foram preservados em backup, o ponto de partida restaurado e as correções reaplicadas antes da validação. O agendamento não foi desativado. O gerador de contexto passou a substituir o JSON de forma atômica, evitando truncamento de arquivo aberto por outro leitor.
- A publicação deliberada da árvore de trabalho foi registrada no `release.json` pelo mecanismo `AllowDirty` existente. O pacote e a configuração anterior foram preservados em `private/backups/publicacao-20260904-095512`.
