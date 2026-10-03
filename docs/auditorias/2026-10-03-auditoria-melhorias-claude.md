# Auditoria das melhorias atribuídas ao Claude — 03/10/2026

## Resultado

As melhorias corrigem problemas reais de leitura da Betha, eliminam milhares de linhas sem identidade e tornam o painel mais útil para o cidadão. A publicação conferida contém as alterações. Entretanto, permanecem riscos de perda de dados no coletor, os serviços PHP continuam indisponíveis e foi encontrada uma regressão na busca por cargos de confiança.

Revisão de `bb769e2` até `9311b3a`: 33 arquivos, 1.224 inserções e 359 remoções. Inclui coletores, carregamento, navegação, páginas, módulos, scripts e testes alterados; os dados atuais também foram examinados. A autoria foi considerada conforme o pedido e o relatório noturno, não inferida apenas do autor Git. Escopo: produto `painel-cidadao` e pipeline associado. Não houve correção de código, coleta Betha, publicação ou mensagem externa nesta auditoria. Testes geram seus artefatos habituais; evidências ficam em `tmp/auditoria-2026-10-03/`.

## Achados acionáveis

### 1. P1 — Preservação da Fundação ainda permite apagar outros conjuntos

Em `painel-cidadao/coletor.py:1788`, a nova função `preservar` protege contratos e listas de licitações. As despesas, execução, diárias, servidores e transferências continuam usando a lista vazia devolvida por `baixar_busca` depois de uma exceção. A função retorna um dicionário não vazio e o fluxo em `coletor.py:3143` grava esse resultado.

Reprodução com token simulado e todas as consultas lançando `TimeoutError`: contratos anteriores preservados, mas despesas R$ 0, execução com zero registros/pagamentos, diárias zero e servidores zero. A variável `falhas` não sai da função; não há status de falha ou preservação no resultado. A base atual da Fundação é corretamente classificada como `manual` pelo verificador por não ter timestamp, mas esse aviso genérico não identifica quais conjuntos falharam.

Não foi observado apagamento atual desses conjuntos na produção. O defeito foi reproduzido sob falha simulada. Preservar cada conjunto e seus metadados anteriores, ou rejeitar a gravação do resultado incompleto. Evidência: `repro-fundacao.log`. O novo teste cobre somente os contratos.

### 2. P1 — PHP segue indisponível em produção

GET de `chat.php` e `avalie.php` retornou HTTP 503. Páginas e JSON estáticos retornaram 200. Isso confirma a indisponibilidade, mas não identifica a causa: verificar logs, serviço PHP e limites da hospedagem. Nenhuma chamada válida à API paga foi realizada. O fallback local do chat não comprova funcionamento do proxy remoto. Evidência: `producao.json`.

### 3. P1 — Contratos ainda podem perder cobertura numa coleta parcial

O trecho `coletor.py:2075` continua considerando parcial somente uma queda para menos de 200 contratos quando a base anterior tinha pelo menos 200. Uma resposta incompleta com 300 registros pode substituir uma base de 1.200 no ciclo completo. O status textual parcial não obriga preservação acima desse piso. A correção CSV/identidade das diárias não resolve completude contratual por exercício.

Não houve perda observada neste ciclo: a base local tem 1.200 contratos e status `coleta_atual`. O risco permanece no código. Validar a completude por exercício e identidade antes de substituir a base.

### 4. P2 — Busca “cargos de confiança” aplica filtro indevido

Em `painel-cidadao/app.js:6387`, `termoResidual` compara cada palavra com os primeiros cinco caracteres das expressões da regra. Remove “cargos”, mas mantém “confiança”. Reproduzido no navegador: a busca navega para `pessoal.html?tipo=comissionado&q=confian%C3%A7a`.

A página pesquisa o termo residual em nome/lotação, restringindo indevidamente os cargos comissionados. Remover as palavras da expressão reconhecida antes de montar o filtro; manter nomes realmente adicionais. Evidência: URL em `repro-busca.log`. A tentativa de aguardar texto da lista expirou e não é usada para afirmar uma contagem de resultados.

### 5. P2 — Limpeza de datas ocorre depois da seleção de contratos

O novo `limparDatasContratos` melhora a apresentação HTTP de Prefeitura/Câmara. Entretanto, `_contrato_vigente` em `coletor.py:2202` continua tratando `dataVigenciaFinal: "-"` como data explícita e retorna falso mesmo com `situacao: "EXECUCAO"`. A seleção histórica acontece antes do JavaScript; limpar a data no navegador não recupera o contrato excluído pelo coletor. Reprodução confirmada em `repro-fundacao.log`.

Normalizar datas na entrada do coletor, preservando a distinção entre data ausente e data válida vencida.

### 6. P2 — Novos testes Python não são obrigatórios na publicação

Os 12 testes adicionados são úteis, mas `package.json` não mudou: `release` não executa `test:pipeline`, e os agendamentos continuam usando `-SkipTests`. Os testes contratuais também não cobrem completude por exercício. A validação de pacote não substitui o teste de um timeout ou uma resposta parcial.

Incluir os testes essenciais de preservação no gate obrigatório anterior à publicação, inclusive quando a rotina rápida pula testes de interface.

## Melhorias confirmadas

| Área | Verificação |
|---|---|
| Betha CSV | Aliases por consulta e cabeçalhos obrigatórios; testes cobrem leitura de Câmara/frota e rejeição de linhas sem identidade. |
| Diárias | Prefeitura: 6.361 registros, R$ 2.640.047,27; Câmara: 251, R$ 152.465,00. Nenhum registro atual sem beneficiário. Zero pago deixa de ser trocado por empenhado pela avaliação booleana. |
| Frota | 850 veículos; chunk de 2.094.414 bytes, em vez dos aproximadamente 192 MB da auditoria anterior. Base recuperada de backup não equivale a uma nova coleta completa. |
| Carregamento | Home inicial 372.127 bytes; Prefeitura 2.083.821; Câmara 2.083.016. Orçamentos aprovados. Diárias atuais: 3.750.658 bytes, antes cerca de 65 MB. |
| Interface | Menu agrupado, dobras móveis com ajuste por mudança de largura e abertura por âncora, paginação de diárias, rankings reduzidos e períodos nas emendas. |
| Contratos | Escape dos campos alterados, supressão de datas/identificadores inválidos na apresentação e custo diário condicionado a intervalo válido. |
| Pessoal | Primeiro escalão derivado da folha, com valores bruto/líquido e referência mensal; não constitui validação independente do cadastro oficial de secretarias. |
| Sanções | Teste e texto de suspensão agora distinguem completude de contratos/obras do status agregado do domínio; correção coerente com o gerador. |
| Como cobrar | Canais, endereço, horários e prazo padrão correspondem à [Ouvidoria oficial](https://www.varginha.mg.gov.br/portal/ouvidoria), consultada em 03/10. A página distingue reclamação de pedido de informação. |

A máscara de CPF foi introduzida na função de apresentação `cleanText`. Isso não comprova anonimização dos JSON brutos ou de toda exportação. Não classifiquei o tratamento visual como garantia de remoção dos documentos pessoais da publicação.

## Publicação e integridade

Conferidos diretamente em `https://fiscalizavarginha.com.br/`: `index.html`, `cobrar.html`, `app.js`, `modules/pessoal.js`, `prefeitura_frota.json`, `fundacao_cultural.json`, `diarias.json` e `atualizado_em.json`.

Os arquivos conferidos correspondem aos locais; para HTML, removido somente o parâmetro de versão dos recursos aplicado pelo empacotador. Carimbo publicado: `2026-10-03T07:06:00`. Fundação publicada: 919 contratos. Os 38 chunks do manifesto local têm tamanho e SHA-256 corretos. Isso é verificação da amostra remota e de todos os chunks locais, não certificação de todas as linhas contra a Betha.

Uma primeira requisição a `frota.json` retornou 404 porque esse não é o nome usado pelo produto; a conferência correta de `prefeitura_frota.json` retornou 200 e conteúdo idêntico. Não é achado de indisponibilidade.

## Validação executada

- Python: 213 testes aprovados.
- Contratos Node: 50 testes aprovados.
- Unitários de texto, busca e moeda: aprovados.
- Sintaxe, acentos, SEO, orçamento inicial, segurança e números publicados: aprovados.
- Validadores de dados e do pacote existente: aprovados; aviso de chunk extra `indice_relevancia` no manifesto local.
- `npm audit --omit=dev`: zero vulnerabilidades reportadas; não é análise completa de segurança.
- Navegador: 214 aprovados, 2 ignorados e 2 falhas em 12,3 minutos. As falhas ocorreram antes da inicialização das páginas, em `smoke.spec.js:555` (frota) e `:569` (placar Câmara), com timeout de 45 segundos.
- Repetição dos dois casos isolados: ambos aprovados em 15,7 segundos. Há intermitência na execução completa; não foi reproduzido um defeito persistente de frota/placar, nem demonstrada a causa do timeout. Houve navegação adicional de diagnóstico durante a suíte, portanto contenção do ambiente também é uma hipótese. Não trato a suíte completa como integralmente aprovada.
- Pacote existente: 4 testes de deploy aprovados em 6,1 segundos.

Não executei `release`, pois ele reescreve derivados e empacota; executei verificações independentes. A validação do pacote existente não comprova que ele corresponde a cada alteração local posterior. Não foi executada nova coleta completa nem auditoria manual com leitor de tela. Os tempos de carregamento divulgados por Claude não foram repetidos em dispositivo físico; bytes menores foram confirmados.

## Situação da auditoria anterior

| Achado de 02/10 | Situação após as melhorias |
|---|---|
| PHP 503 | Continua confirmado. |
| Fallback do slim para JSON gigante | Transferência foi drasticamente reduzida; fallback em qualquer erro permanece. |
| Contratos parciais substituem completos | Permanece. |
| Data “-” exclui contrato vigente | Apresentação melhorou; coletor continua incorreto. |
| Identidade fraca na restauração contratual | Script não alterado; achado anterior permanece. Não foi feita nova restauração. |
| Testes fora do gate automático | Permanece; também afeta os testes Python novos. |
| Hook mede working tree, não blob staged | Não alterado; achado anterior permanece. |
| `substr` pode cortar UTF-8 no PHP | Permanece em `chat.php:84,681`. |
| Carga sob demanda muito pesada | Problema material reduzido; orçamento ainda cobre só carga inicial e SW ainda compara textos completos. |
| Enriquecimento CNPJ perde fornecedores após falha | Fluxo não alterado; achado anterior permanece. |
| Teste de sanções usa status agregado inadequado | Corrigido no teste e no texto explicativo. |

Prioridade: proteger todos os conjuntos da Fundação e a completude contratual, restabelecer PHP, corrigir busca e normalização das datas, e tornar a proteção contra perda de dados obrigatória no pipeline.
