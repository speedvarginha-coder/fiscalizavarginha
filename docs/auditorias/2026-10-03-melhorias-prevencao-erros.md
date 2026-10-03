# Proteções contra erros de coleta e publicação — 03/10/2026

Implementação local decorrente da auditoria das melhorias do Claude.

## Alterações

- Fundação: preservação por conjunto (despesas, execução, contratos, licitações, diárias, pessoal e transferências), incluindo seus resumos. Consultas bem-sucedidas continuam atualizando os demais conjuntos. Falha sem base anterior bloqueia a gravação; retorno vazio confirmado continua sendo aceito como vazio.
- Fundação: status e última coleta completa registrados por conjunto, sem atualizar artificialmente a data dos dados preservados. A interface exibe aviso e data anterior, ou informa que a data é desconhecida. Falha na mudança de exercício bloqueia a mistura de valores antigos com rótulos do ano novo.
- Prefeitura e Câmara: contratos incompletos são preservados independentemente do piso antigo de 200 registros. A proteção compara identidade (número, ano, fornecedor, entidade; objeto quando não há número), registros recentes/vigentes e status das consultas. Na Prefeitura também exige o número de exercícios previsto para o modo de coleta.
- Câmara: falha nas despesas bloqueia a gravação; licitações parciais preservam a base anterior e seu estado de coleta.
- Betha: paginação textual rejeita contagem incompleta, mudança do total informado, ausência de total e registros integralmente repetidos. Isso impede que uma página interrompida seja confundida com conclusão.
- Datas: normalização de datas brasileiras/ISO no coletor. Marcadores ou datas inválidas não são usados como datas vencidas para excluir contratos em execução.
- Busca: “cargos de confiança” aplica somente o filtro de comissionados; nomes adicionais continuam pesquisáveis.
- Publicação: `test:critical` reúne Python, contratos e testes do verificador externo. Integra `test:data`, já obrigatório mesmo com `-SkipTests`, e `release` depois da preparação/validação dos dados.
- Pós-publicação: ambos os envios do pipeline executam `health:external` antes de serem considerados bem-sucedidos. Além de manifesto/release e idade, ele verifica páginas, hashes de três chunks essenciais, resposta de rejeição GET do chat e saúde do armazenamento do Avalie. Não faz pergunta válida à API paga nem registra avaliação.

## Verificação

- 222 testes Python aprovados.
- 50 testes de contratos Node aprovados.
- Teste do verificador externo aprovado: cenário saudável, PHP 503 e chunk adulterado com home ainda respondendo 200.
- Navegador: 42 aprovados e 2 ignorados no conjunto HTTP/cálculos/sanções; as duas regressões específicas (busca e aviso da Fundação) também passaram.
- `test:data` aprovado, incluindo seus 15 testes de cálculos no navegador.
- Sintaxe, acentos, unitários de texto/busca/moeda, segurança e orçamento de desempenho aprovados; PowerShell analisado sem erro de sintaxe.
- Pacote candidato em `tmp/melhorias-candidato/`: validação aprovada e 4 testes de deploy aprovados. Foi gerado com `-AllowDirty` somente para validação local, com essa condição registrada no release. O bloqueio padrão do empacotamento não foi removido.

Durante a execução, o ciclo automático das 10h restaurou dados ao rejeitar código não commitado no empacotamento. Após seu encerramento, o bundle foi regenerado com os chunks preservados e a suíte crítica passou. Não foi iniciada coleta externa por esta implementação.

Logs: `tmp/melhorias-critical.log`, `tmp/melhorias-gate.log`, `tmp/melhorias-browser.log`, `tmp/melhorias-regressoes.log`, `tmp/melhorias-deploy.log` e `tmp/melhorias-site-health.json`.

## Limitações e ativação

As mudanças estão na árvore de trabalho, sem commit ou publicação nesta tarefa. O agendamento continua recusando empacotar código não commitado. O pacote candidato não substituiu o pacote normal de produção.

O novo verificador confirmou `chat.php: HTTP 503; esperado 405` em produção às 10h22 de Brasília. A causa exige diagnóstico do PHP/logs da Hostinger; não foi corrigida pela mudança local. Após ativar o novo pipeline, esse estado impedirá que o deploy seja registrado como saudável.

A proteção contratual é conservadora: remoção ou mudança de identidade na fonte pode exigir reconciliação antes de aceitar a substituição completa. Não comprova, sozinha, que a Betha publicou todos os contratos existentes; evita perdas observáveis em relação à base anterior. A suíte completa de todas as páginas não foi repetida nesta implementação; foram executados os conjuntos afetados e o pacote.
