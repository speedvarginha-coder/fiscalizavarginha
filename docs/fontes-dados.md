# Fontes de dados — "mapa da mina" (Fiscaliza Varginha)

> Código IBGE de Varginha: **3170701** (chave para filtrar portais federais).
>
> ⚠️ **Links são candidatos, não verdade.** Verificar (resolve? formato?) antes de
> integrar no `coletor.py`. Já houve caso de link "revisado" que não resolvia
> (`tcemg.tc.br` deu ECONNREFUSED; o correto é `tce.mg.gov.br`). Confirme com
> `WebFetch`/curl antes de codar contra um endpoint.

Legenda: ✅ já integrado · 🆕 novo (vale integrar) · 🔎 verificar link/endpoint

## Federal & nacionais
| Fonte | Uso no cruzamento | Status | Link |
|---|---|---|---|
| PNCP | editais/atas/contratos do município | ✅ | https://pncp.gov.br/ |
| Transparência Federal | recursos federais por município (3170701) | 🔎 | https://portaldatransparencia.gov.br/municipios/3170701 |
| Transferegov | convênios União×Varginha antes da obra | 🆕 | https://www.gov.br/transferegov/pt-br |
| Compras.gov.br | compras federais (referência) | 🆕🔎 | https://www.gov.br/compras/pt-br |
| Painel de Preços | preço de referência → sobrepreço | 🆕🔎 | https://paineldeprecos.planejamento.gov.br/ |
| Receita — CNPJ (dados abertos) | **QSA/sócios, capital, data abertura, CNAE** | 🆕 (hoje só stub) | https://dados.gov.br/dataset/cnpj |
| CEIS/CNEP (sanções) | fornecedor punido/inidôneo | ✅ | https://portaldatransparencia.gov.br/sancoes |
| CNJ Improbidade | sócio/agente já condenado | 🆕🔎 | https://www.cnj.jus.br/improbidade_adm/consultar_requerido.php |
| PEP (COAF) | agente exposto + parentes (parentesco) | 🆕🔎 | https://www.gov.br/coaf/pt-br/assuntos/pessoas-expostas-politicamente |
| TSE — DivulgaCandContas | **doadores de campanha + bens** | 🆕 | https://divulgacandcontas.tse.jus.br/ |
| TSE — Dados Abertos | candidatos/partidos/resultados | 🆕🔎 | https://dadosabertos.tse.jus.br/ |
| TCU Dados Abertos | contas julgadas irregulares | 🆕🔎 | https://portal.tcu.gov.br/comunidades/dados-abertos/ |
| Base dos Dados | tabelas públicas já limpas (acelera TSE/Receita) | 🆕 | https://basedosdados.org/ |
| IBGE / DATASUS / INEP | contexto (saúde/educação/demografia) | 🔎 | https://www.ibge.gov.br/ · https://datasus.saude.gov.br/ |

## Varginha & Minas Gerais
| Fonte | Uso | Status | Link |
|---|---|---|---|
| Transparência Varginha (Betha) | despesas/contratos/pessoal | ✅ | https://transparencia.betha.cloud/ |
| Diário Oficial Varginha | termos sensíveis (dispensa, inexigibilidade, aditivo) | ✅ | https://www.varginha.mg.gov.br/portal/diario-oficial |
| SAPL Câmara | projetos de lei, emendas, atuação | ✅ | https://sapl.varginha.mg.leg.br/ |
| TCE-MG | tribunal de contas | ✅ | https://www.tce.mg.gov.br/ |
| Fiscalizando com TCE-MG | obras/contas municipais estruturadas | 🆕🔎 | https://fiscalizandocomtce.tce.mg.gov.br/ |
| Transparência MG | repasses/convênios estaduais ao município | 🆕🔎 | http://www.transparencia.mg.gov.br/ |
| Dados Abertos MG | repositórios estaduais | 🆕🔎 | https://dados.mg.gov.br/ |
| Cagef-MG | situação cadastral de fornecedor em MG | 🆕🔎 | http://www.compras.mg.gov.br/ |

## Cruzamentos prioritários (o "coração do robô")
Tudo no **momento da coleta** (`coletor.py` enriquece chunks → grava "sinais para conferir"); site segue **estático, sem backend**. Sempre como **sinal a verificar, nunca acusação**. LGPD: CPF mascarado.

1. **Receita CNPJ completo** (fundação): empresa aberta dias antes do contrato · sócio em comum entre fornecedores · CNAE incompatível com o objeto · mesmo endereço.
2. **TSE doadores × sócios** (rei): sócio de fornecedor que doou à campanha de político local. Depende de (1).
3. **PEP/COAF + parentesco**: fornecedor/sócio com vínculo de parentesco a agente exposto.
4. **CNJ Improbidade / TCU / CEIS-CNEP**: contratado/sócio já sancionado ou condenado.
5. **Painel de Preços**: preço unitário do contrato × referência federal (sobrepreço).
6. **Transferegov / Transparência MG**: rastrear repasse federal/estadual → execução local.

Acelerador: **Base dos Dados** já entrega TSE/Receita limpos — pode encurtar (1) e (2).
