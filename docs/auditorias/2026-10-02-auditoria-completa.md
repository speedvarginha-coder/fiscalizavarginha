# Auditoria do Fiscaliza Varginha — 02/10/2026

## Resultado

O painel está publicado e a integridade local dos arquivos está preservada, mas a suíte completa não está aprovada. Há problemas de disponibilidade do PHP e de preservação/carregamento de dados que exigem correção. Testes aprovados não demonstram cobertura completa das fontes nem funcionamento do chat na hospedagem.

Auditoria sem alteração de código, coleta externa, publicação ou envio de mensagens. Foram acrescentados este relatório e logs em `tmp/auditoria-2026-10-02/`; testes produziram seus artefatos habituais. O foco é o produto oficial `painel-cidadao/`, coletores, pipeline, pacote, CI e hospedagem. Laboratórios `dashboard/` e `painel-v2/` não foram auditados como produtos independentes.

## Situação verificada

- Commit local e publicado: `bb769e282d3946e59e9eb281772827eddbcdfdb8`.
- Release remoto: `2026-10-02T13:24:18.3411470Z` (10:24:18 em Brasília).
- SHA-256 do manifesto remoto: `277bdcc4b093a65adbafab0a4c07b12080263d0d901aace0795270ab1925e10a`; corresponde ao release remoto.
- 38 chunks locais com bytes e SHA-256 correspondentes ao manifesto; 37 no manifesto publicado, que exclui o índice legislativo.
- Prefeitura local e publicada: 1.195 registros contratuais, anos 2019–2026. Há 95 contratos anteriores a 2025 com data final futura. A concessão da Viação Real está presente: 121/2022, R$ 231.032.953,09, data final 12/12/2037.
- Sanções atualizadas em `2026-10-02T10:45:11+00:00`: 1.060 fornecedores verificados e 280 registros encontrados. Registros encontrados não equivalem a irregularidades nem impedimentos aplicáveis a Varginha.
- Os hashes remotos de `app.js`, `data-loader.js`, `style.css`, `sw.js`, `relatorios.html` e `prefeitura_painel.json` correspondem ao inventário do release remoto.
- 12 avisos de qualidade e zero erros registrados na auditoria de dados existente. Entre as limitações: Fundação com 919 contratos sem modalidade; diárias 2026 sem destino/finalidade em 2.627 registros da Prefeitura e 72 da Câmara; resultados de licitações defasados em aproximadamente 48,5 dias.

Esses resultados substituem os status antigos desta conversa: o site não permanece com 1.080 contratos, a cobertura de sanções não permanece em 517 fornecedores e uma publicação posterior efetivamente ocorreu. Não foi possível identificar quem executou essa publicação somente pelos metadados consultados.

## Achados por prioridade

### 1. P1 — Serviço PHP indisponível em produção

`chat.php` respondeu 503 em HTML tanto a GET quanto a POST com JSON inválido. `avalie.php` também respondeu 503 em HTML. O código do chat deveria rejeitar GET com 405 e JSON inválido com 400, antes dos contadores e da API paga (`chat.php:59–90`).

Isso não comprova problema no contador. A resposta é compatível com falha do serviço PHP/hospedagem ou execução anterior à validação, e requer logs do servidor para identificar a causa. A atribuição anterior do 503 à pasta temporária foi precipitada. Conferir PHP, limites de processos/recursos e error logs na Hostinger; depois repetir GET e POST inválido antes de uma pergunta real. Nenhuma chamada válida/paga foi feita nesta auditoria.

Evidência: `tmp/auditoria-2026-10-02/php-producao.json`.

### 2. P1 — Falha do chunk enxuto ainda dispara download de 281 MB

`data-loader.js:193–205` captura qualquer erro do arquivo enxuto e busca o arquivo canônico. Um 503 de `prefeitura_painel.json` provoca requisição de `prefeitura.json`, atualmente com 281.362.671 bytes. O fallback não se limita à migração de formato ou a 404.

Reprodução: a função real `fetchChunk` foi executada em VM com o enxuto retornando 503; as requisições foram, em sequência, `prefeitura_painel.json` e `prefeitura.json`. A guarda que restringe `data.js` ao modo arquivo não protege esse caminho.

Correção: falhar com aviso/tentativa novamente quando a projeção não estiver disponível; impedir fallback para bases pesadas e cobrir esse caminho com teste de requisições.

### 3. P1 — Coleta parcial pode substituir uma base completa de contratos

`coletor.py:2046–2064` reconhece respostas parciais, mas preserva a lista anterior apenas quando a nova tem menos de 200 registros e a anterior tem pelo menos 200. Uma coleta com 300 ou 1.000 contratos pode perder um ou mais anos e ainda substituir a base completa no ciclo normal. A falha por ano é registrada como `failed` em `coletor.py:2174`, mas esse estado não participa da condição específica de preservação.

Correção: avaliar sucesso e completude por exercício solicitado; preservar o exercício cuja coleta falhou/foi parcial e só remover registros após reconciliação completa. Um piso total não detecta perda de um exercício. Este é um caminho confirmado no código, não evidência de perda nova ocorrida hoje.

### 4. P2 — Marcador de data ausente exclui contratos do resgate histórico

`coletor.py:2184–2191` considera qualquer texto não vazio como data final e compara lexicograficamente. `"-"` retorna falso mesmo com situação `EXECUCAO`; data vazia, com a mesma situação, retorna verdadeiro.

Na base atual há 483 registros com `data_fim="-"`, dos quais 478 em `EXECUCAO`. Eles pertencem a 2025/2026 e entram hoje pelos anos recentes, mas o mesmo formato é descartado no filtro dos anos antigos. Não foi apurada a quantidade de contratos antigos ausentes na fonte.

Correção: normalizar marcadores ausentes na entrada e validar o formato da data antes de compará-la; conservar a distinção entre vigência comprovada e situação informada pela fonte. Acrescentar regressão para `"-"`.

### 5. P2 — Restauração confunde contratos de fornecedores/entidades diferentes

`restore-contratos-vigentes.py:19–20,35–37` identifica o contrato apenas por número e ano. A base atual tem 122 grupos número/ano com fornecedores diferentes. A reprodução com dois contratos de entidades/CNPJs diferentes devolveu a mesma chave, impedindo restaurar um deles se o outro já existir.

Além disso, a lista de chaves existentes não é atualizada durante a seleção dos candidatos; candidatos antigos repetidos podem entrar juntos. Correção: reutilizar uma identidade com entidade e fornecedor/identificador da fonte, deduplicar candidatos e fixar a revisão de origem no registro da restauração. Não executar nova restauração indiscriminada antes de reconciliar as identidades.

### 6. P2 — Teste novo de contratos não protege a publicação agendada

`test_contratos_vigentes.mjs:16,22` exige apenas 40 contratos antigos e um contrato acima de R$ 100 milhões. Uma base que mantenha esses poucos registros e perca outros continua aprovada. Os limites também dependem do relógio e envelhecem.

O `release` executa `test:contracts`, mas `update-data.ps1:904–924` executa `test:data` e, opcionalmente, `npm test`; nenhum desses comandos inclui o teste de contratos em Node. As rotinas de agendamento em `package.json:7–8` passam `-SkipTests`. A correção anterior não garante que o incidente seja bloqueado no fluxo automático.

Correção: incluir um teste de reconciliação por identidade/exercício no gate obrigatório do pipeline. Usar dados sintéticos e data fixa para a regra de preservação; manter checagens de cobertura real separadas dos testes de comportamento. `release` também não executa `test:pipeline`, embora o CI execute a suíte Python.

### 7. P2 — Hook verifica conteúdo diferente daquele que será commitado

`.githooks/pre-commit:5–7` separa nomes por espaços e mede o arquivo do working tree com `wc -c`. Caminhos com espaços ou caracteres escapados podem ser ignorados, e um blob grande preparado no index seguido de um arquivo pequeno no disco passa na medição. Deleção no working tree após staging também é ignorada.

Correção: processar nomes com separador NUL e medir o blob do index com Git. A configuração `.githooks` está ativa neste clone; não é instalada automaticamente em clones novos. O uso de `--no-verify` também continua possível. Não foi alterado o staging nesta auditoria.

### 8. P2 — Corte de pergunta/histórico pode invalidar UTF-8 no chat

`chat.php:84,681` usa `substr` por bytes. Com 499 caracteres ASCII seguidos de `á`, o corte em 500 bytes deixa metade do caractere; `json_encode` retorna falso com `Malformed UTF-8 characters, possibly incorrectly encoded`.

Correção: truncar preservando fronteiras UTF-8 e verificar erro de serialização antes de iniciar cURL. Cobrir pergunta e histórico. Isso é independente do 503 observado na hospedagem.

### 9. P2 — Desempenho aprovado cobre somente a carga inicial

`check-performance-budget.mjs:41–44` exclui segunda fase e carga sob demanda. `prefeitura_frota.json` tem 191.996.524 bytes e `diarias.json` tem 64.787.258 bytes. Clicar no detalhe ainda pode exigir transferência, parse e memória elevados. São bytes locais sem compressão; não foram medidos tempos reais em celulares.

`sw.js:82–106` compara versões dos chunks convertendo respostas inteiras em texto, além de copiá-las para cache, aumentando a pressão de memória para arquivos grandes. Correção: recortes por período/domínio e limites também para carga sob demanda; comparar versão/hash em vez de textos gigantes. O orçamento inicial aprovado não comprova leveza desses detalhes.

### 10. P2 — Enriquecimento de fornecedores desaparece quando a segunda etapa falha

`coletor.py:3032–3034` grava primeiro o resultado cadastral de emendas em `cnpjs.json`; só posteriormente, em `3088–3100`, acrescenta fornecedores. Se essa segunda etapa falhar, a exceção é apenas exibida e o arquivo já sobrescrito permanece sem a chave. A base atual tem 83 empresas e zero fornecedores enriquecidos; a UI lê `cnpjs.fornecedores || []` e oculta a ausência sem quebrar.

A ausência foi confirmada; não foi identificado o ciclo específico que a causou. Correção: preservar o enriquecimento anterior com carimbo e status explícito até a etapa seguinte ser concluída, evitando publicação intermediária destrutiva.

### 11. P2 — Teste de suspensão nominal mistura status do domínio com completude do dataset

`tests/sancoes-classificacao.spec.js:74–84` falhou na suíte completa e novamente isolado: encontrou `camara-despesa-sem-contrato` junto com `auditoria-vinculos-suspensa-por-frescor`. Os dois alertas também foram encontrados no JSON publicado. Evidência adicional: `tmp/auditoria-2026-10-02/sancoes-isolado.log`.

Hoje a Prefeitura está `preserved` no status agregado porque obras/frota foram preservadas, enquanto `contratos_status_coleta` está `coleta_atual`. O gerador usa `contratosAuditaveis` para a Câmara (`audit-data-quality.mjs:649`) e exige também `obrasAuditaveis` para o cruzamento da Prefeitura (`:692`). O teste usa o status agregado de Prefeitura/Câmara para proibir todos os alertas, criando contratos diferentes entre teste, algoritmo e texto do aviso de suspensão.

Correção: definir a dependência de cada alerta por dataset e alinhar teste e aviso a essa regra. Não remover a asserção nem considerar o release aprovado antes de resolver a divergência. A falha não demonstra, isoladamente, que os nomes da Câmara foram publicados com contratos incompletos.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| Integridade bytes/SHA-256 do manifesto local | 38/38 corretos |
| Schemas | Aprovados: 38 chunks, 18 fontes e 18 monitoradas |
| Testes Python | 201 aprovados |
| Contratos Node | 50 aprovados |
| Unitários Node e segurança do chat | Aprovados |
| Sintaxe JavaScript | 32 arquivos aprovados |
| Sintaxe PHP do chat | Aprovada no PHP local |
| Números publicados | Aprovados |
| SEO e acentos | Aprovados |
| Orçamento inicial | Todas as páginas medidas aprovadas |
| npm audit completo, incluindo devDependencies | Zero vulnerabilidades reportadas |
| Validação do pacote existente | Aprovada |
| HTTP contra pacote existente | 4 aprovados |
| Lock do pipeline | Aprovado |
| Restauração atômica e financeira isoladas | Aprovadas com importação explícita do módulo de hash; 16 arquivos financeiros conferidos |
| Playwright completo | 215 aprovados, 1 falhou, 2 ignorados; saída 1; 13,1 minutos |

Carga JSON inicial: Início 371.305 bytes; Prefeitura 2.058.136; Câmara 2.076.388; Relatórios 2.395.295; Atualizações 1.586.611. JS principal: 471.921 bytes; CSS: 334.062 bytes.

## Segurança, operação e limitações

- Em produção, caminhos ocultos testados responderam 403; `coletor.py` respondeu 404. JSON público trouxe `nosniff`, `X-Frame-Options: DENY` e revalidação de cache.
- Busca limitada por campos com CPF completo nos chunks Pessoal, Diárias, CNPJs e Prefeitura enxuta não encontrou valores de 11 dígitos sem máscara. Não equivale a auditoria integral de privacidade ou conformidade jurídica.
- Não foram lidas/impressas credenciais nem feitos testes de exploração ou carga contra produção.
- O upload existente usa FTPS por padrão e publica `release.json` por último. A troca é por arquivo, não por versão inteira: durante um upload existe janela de combinação de versões; o health check compara release/manifesto, não todos os arquivos remotos. Nesta auditoria foram verificados seis hashes remotos, não o inventário inteiro.
- O Git está com 115 entradas pendentes, concentradas em dados, snapshots e artefatos não rastreados. Os chunks de 281 MB e 65 MB permanecem rastreados e modificados; a frota de 192 MB está não rastreada. Não recomendar `git add -A`.
- Não foram inspecionados Task Scheduler real, logs privados da Hostinger, execução real do WhatsApp, todas as fontes primárias nem fluxo real de pergunta Gemini. Testes de navegador local não executam Apache/PHP.
- `npm run test:restore` e `test:restore:financeiro` falharam inicialmente com `Get-FileHash` indisponível no subprocesso PowerShell 5.1. Ambos passaram com `Import-Module Microsoft.PowerShell.Utility` explícito. O comando `Get-Command Get-FileHash` encontra o módulo instalado; a causa da diferença de carregamento automático não foi determinada. Isso limita a afirmação de que os comandos npm de restauração passam sem ajustes neste ambiente.
- O verificador de saúde registrou heartbeat de aproximadamente 2,9 horas e último sucesso de 2,6 horas, com saída zero. Isso é evidência do estado registrado, não inspeção das tarefas do Windows.
- A base antiga e a atual não foram reconciliadas contrato a contrato com a fonte oficial. Portanto, os R$ 666 milhões descritos na restauração anterior não demonstram despesa nova, fraude ou perda financeira; representam soma de valores cadastrais selecionados de uma revisão anterior.

## Ordem de correção

1. Diagnosticar o serviço PHP na Hostinger e recuperar o chat.
2. Bloquear fallback pesado e corrigir preservação de contratos por exercício.
3. Corrigir datas ausentes, identidade de restauração e gate automático.
4. Corrigir hook, truncamento UTF-8 e preservação do enriquecimento.
5. Dividir bases pesadas e medir uso real de memória/transferência no celular.
