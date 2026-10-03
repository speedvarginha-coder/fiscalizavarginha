# Trabalho da noite de 02/10/2026

Relatório para revisão na manhã de 03/10. Tudo foi feito com a autorização dada no fim da tarde ("fazer tudo até esgotar os trabalhos").

## Commits e publicação

Cinco commits de código locais no `master`, mais o deste relatório, nada enviado ao GitHub:

| Commit | Conteúdo |
|---|---|
| `3947c9b` fix(coleta) | leitura do CSV da Betha, linhas sem identidade, reconciliação, Fundação |
| `f63f669` feat(painel) | menu, home, diárias, contratos, busca, Radar, emendas, auditoria |
| `98e4c0b` feat(pessoal) | bloco do primeiro escalão |
| `c3ff387` feat(cobrar) | caminho para reclamar de um problema; borda redundante removida |
| `a920702` fix(busca) | busca na Prefeitura abre Contratos e mantém o termo na URL (achado A09) |

Os dados não foram commitados; seguem o fluxo normal do pipeline. O `f63f669` inclui a alteração local anterior do `app.js` (quebra dos valores do ranking, feita pelo Codex), que estava pendente.

**Por que commitei:** a vigia das 22:06 coletou e validou os dados, mas o empacotamento recusou publicar. `package-deploy.ps1` bloqueia código não commitado, para que sempre se saiba o que foi ao ar. O pipeline então restaurou os dados ao estado anterior e não publicou nada. Com o código commitado, o empacotamento e a validação do pacote passaram localmente (`deploy:zip` e `validate:deploy`, 4 de 4 testes). A publicação fica com a vigia da 01:06; o resultado está na seção 8.

O `master` local tinha 44 commits não enviados ao GitHub antes desta noite, e agora tem 50. Por isso o pipeline não sincroniza com o GitHub; isso não afeta a publicação no site.

## Como as mudanças chegam ao site

O pipeline agendado publica sozinho na Hostinger, direto desta pasta, sempre que a validação passa e o código está commitado. As vigias rodam às 22:06, 01:06 e 04:06, e a atualização diária às 06:30. Por isso cada leva só entrou na pasta principal depois de passar pela suíte completa de navegador, testada antes numa cópia em `tmp/layout/`.

## 1. Dados corrigidos

### Diárias e frota: linhas vazias publicadas como registros

- **Sintoma:** a home dizia "135.884 diárias"; 129.619 eram linhas sem nome, ano ou valor. A Câmara tinha 1.469 diárias com R$ 0,00. A aba Frota mostrava "271.565 veículos", nenhum com placa.
- **Causa:** a Betha voltou a entregar os dados em CSV, com colunas em português (`Credor`, `Valor R$`, `Placa do veículo`). O coletor lia outros nomes (`credor`, `valorTotal`, `placa`), gravava linhas em branco e marcava a coleta como "ok". A reconciliação ainda preservava para sempre as linhas sem ano.
- **Correção no código:**
  - `coletor_betha.py`: tradução de colunas por consulta (`ALIASES_POR_CONSULTA`) e colunas obrigatórias (`COLUNAS_OBRIGATORIAS`). O CSV de diárias da Prefeitura não traz o beneficiário, então o coletor cai sozinho para a busca textual, que traz.
  - `coletor.py`: linha sem nome, placa ou ano não entra; ano com maioria de linhas irreconhecíveis conta como falha; pagamento zero não vira mais valor empenhado; a base preservada precisa ser válida (frota com placa), não só ter linhas.
- **Resultado:**

| | Antes | Agora |
|---|---|---|
| Diárias da Prefeitura | 135.884 linhas (95% vazias) | 6.361, todas com nome |
| Diárias da Câmara | 1.469, R$ 0,00 | 251, R$ 152.465,00 |
| Frota | 271.565 sem placa | 850 veículos (base íntegra de 05/09, com gastos) |
| `prefeitura.json` | 281 MB | 5 MB |
| Abrir a aba Frota | 192 MB, 10,5 s | 2,1 MB, 45 ms |

- A frota veio do commit `9bb1163` (05/09). O CSV atual traz 943 veículos, mas sem os gastos; a base de 05/09 tem os gastos e fica marcada como "preservada".
- O snapshot que tinha 135.884 diárias foi movido para `private/backups/rejeitada-linhas-vazias-20261002/snapshots/`. Sem isso, a trava de "queda anormal" barraria toda coleta seguinte.

### Fundação Cultural: timeout apagava contratos

A vigia das 19h teve um timeout da Betha nos contratos da Fundação e gravou 0 contratos por cima dos existentes. A validação barrou a publicação. O coletor agora preserva a base anterior quando um download falha. Os 919 contratos foram restaurados do backup automático das 19:06.

### Diário Oficial: gravação interrompida

A mesma vigia não conseguiu gravar o feed estruturado do Diário (o arquivo estava em uso no Windows) e deixou um `.tmp` válido, com 1.158 publicações até 02/10. Concluí a troca; o arquivo anterior está guardado na pasta de backup.

## 2. Telas corrigidas

- **Contratos sem número ou prazo** (487 da Prefeitura, 40 da Câmara): mostravam "0/2026", período "até /", valor por dia calculado como se o prazo fosse 1 dia e selo "Registro completo: 100%". Agora aparecem como "não informado na fonte", sem valor por dia, e com "pontos para conferir".
- **Selo dos contratos:** "CONFIRA: 88%" virou "Registro completo" ou "2 pontos para conferir".
- **Segurança:** o nome do fornecedor e o número do contrato agora são escapados antes de entrar na página (achado A04 do Codex).
- **Privacidade:** CPF que aparece dentro do nome de MEI (ex.: "PAULO SERGIO ROSA 66250080600") é mascarado. A máscara só atua em números de 11 dígitos que passam no dígito verificador de CPF.
- **Radar PNTP:** a escala agora vai até Inexistente; o texto dizia que "Intermediário" era o nível mais baixo.
- **Home, diárias:** mostra o total da base e diz o período ("2025 e 2026").
- **Home, emendas:** "0 para conferir" lia um campo que não existe; agora mostra as emendas sem pagamento ou sem CNPJ (57). "249 sinais de atenção" virou "emendas com pagamento localizado", que é o que o número conta.
- **Aviso de cruzamentos suspensos:** dizia que todos os alertas de "fornecedor sem contrato" estavam suspensos enquanto o da Câmara seguia ativo. Agora diz exatamente o que foi suspenso. Isso também resolveu o teste que falhava antes (A12 do Codex).

## 3. Layout

- **Menu:** de 11 para 5 itens (Início, Prefeitura, Câmara, Salários, Emendas), mais "Mais" (Fundação Cultural, Atualizações, Relatórios, Meus marcadores, Qualidade dos dados, Sobre o painel) e "Como cobrar". O menu agora aparece aberto a partir de 961 px; antes ficava escondido atrás do botão ☰ abaixo de 1.180 px, o que incluía notebooks comuns.
- **Home no celular:**
  - Busca na primeira tela (de 839 px para 503 px do topo).
  - Atalhos em duas colunas.
  - Orçamento, ciclo e Radar recolhidos com título; no computador continuam abertos.
  - Altura de 14.266 px para 9.298 px.
- **Ordem da home:** Central de fiscalização → Orçamento → Ciclo → Radar. Ação primeiro, contexto depois.
- **Diárias:** selo e proveniência uma vez no topo, não repetidos em cada cartão; 20 cartões com "Mostrar mais". No celular, a aba caiu de 84.321 px para 26.722 px.
- **Busca:**
  - "Salário do prefeito" abre a página Pessoal já filtrada em "prefeito" e rola até o resultado.
  - O nome de um vereador abre a aba Emendas com o painel completo dele.
  - Na Prefeitura, uma busca sem aba indicada abre Contratos, onde o resultado aparece. Antes abria a Visão geral, e o "Nenhum contrato encontrado" ficava escondido. O termo agora continua na URL mesmo sem resultado (achado A09).
- **Textos de vereadores:** os cartões e atalhos da home deixaram de prometer o que não mostram. O atalho "Vereadores" leva à aba de remuneração ("quanto recebem?"), e a pergunta pronta leva à escolha do vereador.
- **Rankings de diárias:** 5 posições à vista e "Ver posições 6 a 15" (cada linha tem cerca de 280 px no celular).
- **Contratos:** proveniência uma vez por lista (cartão de 814 px para 719 px no celular). Na Câmara: datas no formato brasileiro, "sem prazo informado" e "número não informado na fonte" em vez de "Nº 0".
- **Emendas:** cada esfera mostra o período que cobre ("Federal 2015 a 2026", "Municipal 2024 e 2025"); uma frase explica por que a soma dos três cartões não é o total "Indicado". Na Câmara, o placar diz "357 emendas em 2025".
- **Pessoal:** bloco "Primeiro escalão" com prefeito, vice e 14 secretários (bruto, líquido, vínculo e mês). O total de servidores agora diz que conta pessoas distintas.
- **Como cobrar:** novo caminho "Quero reclamar de um problema na cidade", com os canais da Ouvidoria (telefones, e-mail, endereço, horário e prazo de 30 dias), conferidos no site da Prefeitura.

## 4. Correções aos meus próprios diagnósticos

Ao investigar no código, quatro afirmações que fiz durante a auditoria se mostraram erradas ou exageradas:

| Afirmei | O que é |
|---|---|
| A produção dos vereadores "sumiu junto com o Avalie" | Existe: painel completo por vereador na aba Emendas da Câmara (matérias, indicações, projetos, emendas). Faltava a busca levar até lá; agora leva. |
| `camara.html#vereadores` era link morto | Abre a aba Remuneração (salários). O problema era só a frase "quem produz?". |
| Emendas: R$ 67,7 mi contra R$ 87,5 mi era erro de soma | São medidas diferentes por esfera (agregado, declarado, indicado). Falta rótulo, não cálculo. |
| Maior fornecedor da Câmara (Versão BR) sem contrato | A auditoria encontra contrato plurianual na base da Prefeitura. A página da Câmara só não mostra contratos da outra base. |

Também não eram erros: 581 contra 357 emendas municipais (2024+2025 contra 2025) e 4.038 contra 4.154 servidores (pessoas distintas contra linhas da folha). Nos dois casos falta dizer o período ou a medida.

## 5. Verificação

| Verificação | Resultado |
|---|---|
| Testes Python | 213 aprovados (12 novos em `tests/test_coleta_identidade.py`) |
| `validate:data`, `test:data`, `test:contracts`, `test:unit` | aprovados |
| `lint:syntax`, `lint:accents`, `lint:seo`, `performance:budget` | aprovados |
| Suíte de navegador (pasta principal, versão final) | 216 aprovados, 0 falhas, 2 ignorados |
| Linha de base antes desta noite | 215 aprovados, 1 falha (A12) |
| Empacotamento e validação do pacote | aprovados (4 de 4) |

Testes alterados, sempre mantendo a intenção original:

- `tests/sancoes-classificacao.spec.js`: confere a suspensão por base (contratos, obras), igual à auditoria.
- `tests/smoke.spec.js`: confere o selo das diárias na lista, não dentro do cartão.
- `tests/test_radar_pntp.mjs`: recorta o bloco do Radar pelo fim da própria seção, não pelo título do bloco seguinte.
- `tests/test_collector_resilience.py`: o mock aceita o novo parâmetro `valido`.
- `tests/http.spec.js`: a URL da busca aceita o espaço como `%20` ou `+`. As duas formas são o mesmo endereço; com as páginas mais leves, a sincronização dos filtros às vezes reescrevia a URL antes da conferência (falhava em 1 de 5 execuções).

## 6. Como desfazer

- **Código:** desfazer um commit com `git revert <hash>`, ou voltar tudo ao estado de antes com `git reset --hard bb769e2`. O reset apaga também a alteração anterior do Codex no `app.js`.
- **Cópias de arquivo por leva:** `private/backups/rejeitada-linhas-vazias-20261002/` (`codigo-antes-layout/`, `codigo-antes-leva2/`, `codigo-antes-leva3/`).
- **Dados anteriores à correção** (diárias, frota, `prefeitura.json`, snapshot, Diário Oficial): mesma pasta. O prefixo `rejeitada-` impede o coletor de usar essas cópias como base.

## 7. Pendências

- **Chat e Avalie fora do ar (503):** a resposta vem da página padrão do LiteSpeed da Hostinger para qualquer `.php`, enquanto as páginas estáticas respondem 200. O `.htaccess` não fixa versão de PHP. Isso sugere o PHP da conta parado (versão, limite de processos ou erro do servidor); conferir no hPanel a versão do PHP, os limites (Entry Processes) e o log de erros. Enquanto isso, o chat já responde sozinho por palavras-chave, com o aviso "IA indisponível".
- **Cartões de contrato no celular** (719 px cada): os botões ainda ocupam 172 px.
- **Cruzamento diárias × salário:** falhava de forma intermitente no site publicado; passou em todos os testes locais depois da correção dos dados. Confirmar no site.
- **Estilo da página Pessoal:** o verificador visual aponta bordas laterais grossas e uma animação de largura que já existiam; sugestão para a revisão do sistema visual.
- **Diárias de 2025 da Prefeitura:** a Betha esgotou o tempo em todas as tentativas; segue valendo a base anterior (3.638).

## 8. Resultado da publicação

**Publicado às 01:19 de 03/10** pela vigia da 01:06: "coleta=SUCESSO deploy=SUCESSO". O pacote passou na validação e nos 4 testes de pacote antes do envio.

Conferido no site real logo depois:

| O quê | No ar |
|---|---|
| Menu | Início, Prefeitura, Câmara, Salários, Emendas, Mais, Como cobrar |
| Radar | escala até Inexistente |
| Diárias (arquivo publicado) | 6.361 da Prefeitura, nenhuma sem nome; Câmara com 251 e R$ 152.465,00 |
| Frota (arquivo publicado) | 850 veículos, todos com placa |
| Home no celular | busca a 341 px do topo; altura 9.137 px; dobras fechadas |
| Home, cartões | "6.361 registros de diárias (2025 e 2026)", "57 sem pagamento ou sem CNPJ", "249 emendas com pagamento localizado" |
| Cruzamento diárias × salário | funcionou em 3 de 3 recargas (2 "não localizado", 28 salários; à tarde eram 110 "não localizado") |

**Segunda publicação às 04:26** pela vigia das 04:06 ("coleta=SUCESSO deploy=SUCESSO"), com as duas últimas levas: o bloco de reclamação em "Como cobrar" com a borda removida no ranking (`c3ff387`) e a correção da busca (`a920702`). Conferido no site real: `cobrar.html#reclamar` no ar; `prefeitura.html?q=palestra` abre a aba Contratos com os 4 contratos, mantém o termo na URL e mostra "2 pontos para conferir".

Todo o trabalho desta noite está publicado. Nada ficou pendente na pasta de trabalho além dos dados, que seguem o pipeline.

A cópia de trabalho em `tmp/layout/` (cerca de 470 MB, ignorada pelo git) pode ser apagada.
