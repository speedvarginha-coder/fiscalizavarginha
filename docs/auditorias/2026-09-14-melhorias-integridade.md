# Melhorias de integridade e operação — 14/09/2026

## Alterações

- A coleta registra a tentativa e a última coleta completa por conjunto: contratos, obras e frota da Prefeitura; contratos da Câmara; emendas, convênios, transferências especiais e CEIS da base federal.
- A auditoria calcula a idade pela coleta completa mais antiga entre os conjuntos. Se algum conjunto não tem histórico comprovado, a idade integral permanece desconhecida. O indicador `_preservado` do fallback federal é respeitado mesmo quando o arquivo anterior contém estados `ok`.
- Uma tentativa sem estado de completude permanece `unknown`, mesmo que exista uma data antiga conhecida. Não houve preenchimento retroativo de datas desconhecidas.
- O backup financeiro inclui `prefeitura_frota.json`, escrito pelo gerador de projeções. O inventário passa a 14 arquivos.
- O validador reconhece o chunk de frota, mantendo a verificação de hash e tamanho.
- O limite total dos testes passa a 90 segundos, comportando a espera de inicialização de 45 segundos e as ações seguintes. Não foram removidas expectativas nem adicionadas tentativas automáticas para encobrir falhas.
- Rastros de execução ficam retidos nas falhas. A quarentena passa a guardar os relatórios de teste disponíveis junto com a base rejeitada.
- `openpyxl` foi declarado nas dependências Python. A instalação limpa consegue executar a suíte sem depender do pacote previamente instalado na máquina.
- O CSS mantém as mesmas regras; finais de linha LF reduzem o arquivo de 347.394 para 334.062 bytes. `.gitattributes` mantém esse formato no checkout.
- Diretórios internos de rollback das emendas foram excluídos do versionamento. Documentos, scripts e dados preexistentes do usuário não foram apagados nem incluídos nas alterações por conveniência.

## Diagnóstico e verificação

A coleta das 16h09 havia sido rejeitada por quatro testes. Os seis cenários selecionados da Prefeitura e de Como cobrar passaram usando os dados da própria quarentena em uma cópia isolada. A causa de todas as falhas anteriores não foi comprovada; a incompatibilidade entre o limite total de 30 segundos e a espera interna de 45 segundos foi corrigida. Os novos rastros permitirão investigar uma recorrência.

- 188 testes Python aprovados, inclusive em ambiente virtual novo instalado a partir de `requirements.txt`.
- 41 testes de contratos e regressões da auditoria aprovados na cópia isolada.
- Restauração dos 14 arquivos conferida por SHA-256, incluindo arquivo criado pelo ciclo, inventário unitário e backup ausente. Verificação executada em PowerShell 7 e Windows PowerShell 5.1.
- Segurança do chat, testes unitários, sintaxe de 33 arquivos JS, acentos e SEO aprovados.
- Validação do pacote candidato e de seus hashes aprovada.
- Suíte completa de interface e HTTP: 225 testes aprovados em 12,2 minutos; dois testes condicionais não executados por ausência dos respectivos casos na base.
- Quatro testes HTTP e de navegação do pacote candidato aprovados, incluindo referências documentais, módulos, folha e cache offline.

Conclusão documental registrada em 15/09/2026. Os resultados acima são das execuções de 14/09/2026, conferidas na retomada; não representam uma nova coleta em 15/09.

### Correção adicional verificada em 15/09

O ciclo de 15/09 às 14h54 encontrou `UNKNOWN` ao abrir `status_fontes.json`. A auditoria já havia alterado `auditoria_dados.json`; as duas tentativas seguintes falharam no schema porque o manifesto continuava descrevendo a versão anterior. O ciclo foi restaurado pelo backup.

A auditoria agora prepara os dois JSONs e o manifesto antes de substituir arquivos. Usa arquivos temporários no mesmo diretório, repete erros transitórios de acesso e recompõe os arquivos já substituídos quando uma troca falha. Isso não torna múltiplos arquivos uma transação indivisível para leitores externos; o fluxo continua dependendo do lock e da validação antes da publicação. Falhas de restauração são propagadas ao backup do pipeline, sem declarar sucesso.

Três regressões novas, incluídas em `test:contracts`, cobrem falha no segundo arquivo, falha no manifesto, preservação dos bytes anteriores, remoção de arquivo novo e recuperação de bloqueio transitório. Todas passaram. A execução real da auditoria na cópia isolada produziu zero erros e 12 avisos; a sincronização e a validação final do manifesto passaram. As alterações adicionais não modificam a interface testada em 14/09.

A automação agendada continuou coletando durante o trabalho. O primeiro pacote de teste detectou divergência de hash causada pela mudança dos dados durante a cópia. O candidato validado foi montado com código atualizado e dados consistentes da quarentena `rejeitada-20260914-160748`, em `tmp/melhorias-20260914/release/`. Ele é um artefato de verificação, não uma afirmação de atualização das fontes.

## Limites mantidos

As alterações não recuperam informações que a fonte oficial não entregou. Modalidade de contratação, destino e finalidade de diárias continuam ausentes quando não documentados. Fontes preservadas ou parciais continuam sinalizadas; cruzamentos que dependem de cobertura completa continuam suspensos.

As novas datas de coleta completa começam a existir quando os coletores confirmarem sucesso nos respectivos conjuntos. Nenhuma data de tentativa antiga foi convertida em sucesso. A continuidade da operação depende das fontes e do computador que executa as tarefas agendadas.

Não houve envio de mensagens nem publicação manual do candidato durante esta intervenção.
