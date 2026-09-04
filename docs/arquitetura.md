# Arquitetura — Fiscaliza Varginha

Referência atualizada em 03/09/2026. O produto oficial é o painel estático de `painel-cidadao/`, publicado pelo pacote validado para Hostinger/Apache. `dashboard/` e `painel-v2/` não participam dessa publicação.

## Componentes

| Camada | Responsabilidade |
| --- | --- |
| `coletor*.py` | Consultar fontes oficiais e preservar a última base válida quando a coleta falhar ou regredir |
| `scripts/update-data.ps1` | Coordenar coleta, backup, validação, testes, pacote e publicação |
| `data/chunks/` | Bases públicas canônicas por domínio |
| `scripts/sync-data-bundle.mjs` | Gerar resumos, sincronizar o fallback e calcular o manifesto |
| `data-loader.js` | Selecionar dados e módulos por página; controlar carregamento progressivo |
| `modules/` | Utilitários, dossiês, publicações, pessoal, diárias, indicadores e componentes |
| `app.js` | Inicialização comum e renderizações ainda não extraídas |
| `style.css` | Estilos compartilhados e regras de páginas |
| `chat.php` / `avalie.php` | Funcionalidades de servidor, com estado e credenciais fora do pacote público |
| `sw.js` | Cache offline e aviso de atualização |

Os módulos usam IIFEs e expõem suas funções em `window.FISCALIZA`. Os dados ficam em `window.FISCALIZA_DATA`. Não há compilação de frontend nem dependência de React no produto oficial.

## Carregamento de uma página

1. O HTML declara `body[data-page]` e inclui `data-loader.js`.
2. O loader resolve o plano da página e busca os dados iniciais em paralelo.
3. Os módulos são baixados em paralelo e executados na ordem declarada.
4. `app.js` inicializa os blocos presentes no DOM e emite `fiscaliza:app-ready`.
5. O loader emite `fiscaliza:ready`; os dados de segunda fase chegam por `fiscaliza:chunk`.
6. Diárias da Prefeitura/Câmara são buscadas ao abrir a seção. Pessoal busca a folha nominal somente na página correspondente.

Falha de uma projeção leve tenta o arquivo completo. Abertura por `file://` ou falha de dados críticos usa `data.js`. O fallback é sincronizado com todos os chunks existentes; ele continua maior que a carga normal por HTTP.

## Projeções e carregamento progressivo

- `home_resumo.json`: indicadores e referência SHA-256 à base da Prefeitura.
- `pessoal_resumo.json`: resumo mensal para páginas que não precisam da lista nominal.
- `prefeitura_painel.json`: todos os campos da Prefeitura, exceto os detalhes de `frota`. Mantém todos os contratos, fornecedores, obras e cruzamentos. É usado em Início, Câmara, Relatórios, Atualizações, Marcadores e Fundação.
- Prefeitura e Cobrança continuam recebendo a frota completa, pois a utilizam.
- Resultados de licitações e PCA entram na segunda fase de Relatórios.
- Publicações da Câmara e do Diário entram na segunda fase de Atualizações. O feed informa carregamento ou cobertura parcial e mantém a fonte disponível quando outra falha.

Referência medida em 03/09/2026, somente JSON inicial e sem compressão HTTP:

| Página | Antes | Após a revisão | Limite automático |
| --- | ---: | ---: | ---: |
| Início | 0,91 MB | 0,91 MB | 1,20 MB |
| Prefeitura | 5,80 MB | 5,80 MB | 6,50 MB |
| Câmara | 8,32 MB | 4,64 MB | 5,00 MB |
| Relatórios | 8,52 MB | 4,84 MB | 5,20 MB |
| Atualizações | 9,34 MB | 1,45 MB | 2,00 MB |

`npm run performance:budget` recalcula esses valores pelo plano de carregamento e pelo manifesto. Os números mudam com a coleta; o limite deve ser revisado com justificativa quando a cobertura crescer.

## Integridade e cobertura

O manifesto registra tamanho e SHA-256 dos chunks e snapshots. Os geradores terminam antes de `data:bundle`, que sela o manifesto. Não se deve regravar um chunk após a validação sem sincronizar e validar novamente.

`status_fontes.json` distingue `ok`, `partial`, `preserved`, `manual`, `failed`, `stale` e `unknown`. A data de uma tentativa recente não comprova a atualização de registros preservados: nesse caso `source_updated_at` e `age_days` permanecem desconhecidos, e `checked_at` informa a tentativa conhecida. Datas de contratos ou matérias não servem como carimbo da coleta.

A auditoria mantém limitações, ausência de modalidade, cruzamentos suspensos e falta de confirmação documental visíveis. As projeções não completam campos ausentes na fonte e não convertem ausência de informação em zero confirmado.

## Publicação e cache

`package-deploy.ps1` copia somente arquivos públicos para um diretório de preparação e cria o ZIP. Inclui módulos autorizados, fontes locais, dados, snapshots e PDFs públicos. Os destinos são conferidos antes das remoções. O pacote registra commit, manifesto e eventuais alterações não commitadas em `release.json`.

`validate-release.mjs` verifica a lista obrigatória e as dependências referenciadas no HTML, CSS, loader e service worker. `validate-zip.py` compara cada arquivo do ZIP com os bytes do diretório validado. `npm run validate:deploy` também executa testes HTTP sobre o pacote, incluindo Conformidade, Pessoal, fonte Inter e ativação do service worker.

O cache estático usa cache-first; chunks usam stale-while-revalidate. O empacotamento atribui uma versão de cache ao pacote. Ao adicionar módulos ou fontes, atualizar também o inventário do service worker.

## Testes e manutenção

Ver [tests/README.md](../tests/README.md) para comandos e isolamento. As verificações combinam schemas, hashes, testes de coletores, contratos de dados, cálculos, segurança e navegação HTTP. Não substituem revisão manual da fonte oficial nem teste de PHP/Apache no ambiente publicado.

A renderização de Pessoal foi extraída para `modules/pessoal.js`. `app.js` ainda concentra outras páginas; `style.css` continua compartilhado. Futuras extrações devem preservar a ordem dos estilos, interfaces públicas e resultados dos testes. A operação depende do computador Windows e das condições descritas em [OPERACAO_LOCAL.md](OPERACAO_LOCAL.md).
