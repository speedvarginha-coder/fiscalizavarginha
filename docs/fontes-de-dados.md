# Fontes de dados — Fiscaliza Varginha

De onde vem cada número que aparece no painel. **Sempre** que algo for divulgado publicamente, conferir a fonte oficial primeiro.

> Para fontes candidatas ainda NÃO integradas (links a verificar), veja [`fontes-candidatas.md`](fontes-candidatas.md).

---

## Publicidade Transparente (integrada em 04/11/2026)

- Prefeitura: `publicidade_prefeitura.json`, [portal de origem](https://new.publicidadetransparente.com.br/view/municipio-de-varginha/).
- Câmara: `publicidade_camara.json`, [portal de origem](https://new.publicidadetransparente.com.br/view/camara-municipal-de-varginha-mg/).
- Coletor: `painel-cidadao/coletor_publicidade.py`, executado por `scripts/update-data.ps1` inclusive no modo financeiro/vigia. Monitoramento independente por órgão; vigia solicita coleta após 24 horas, monitor sinaliza defasagem após sete dias.
- Investimentos: lista de períodos obtida no formulário público; consulta HTTP POST ao próprio formulário com `periodo=MM/AAAA`. Primeira execução consulta todos os períodos listados. Próximas execuções revisam os três mais recentes, períodos novos e um histórico por rodízio. O histórico pode receber revisões; a data de consulta é individual por mês.
- Cadastros de veículos, fornecedores ativos/inativos e sessões públicas: consulta das páginas públicas HTML a cada execução. URLs de documentos são referências; o conteúdo dos documentos não foi automaticamente certificado.
- Valores armazenados em centavos inteiros, com soma por meio conferida contra o total declarado. Ausência de total, período divergente, erro de rede ou mudança de estrutura não vira zero: conserva-se a evidência anterior, com sua data e erro da tentativa.
- Não somar esses investimentos aos contratos ou despesas da Betha/PNCP: podem representar os mesmos recursos. O portal declara investimentos, não comprova pagamento, entrega ou contratação dos cadastrados. Mês corrente sujeito a complementação. CPF eventualmente embutido em razão social é mascarado; CNPJ é mantido.
- Exibição: `relatorios.html#publicidade`; indicação das fontes em `sobre.html#fontes-dados`. O horário da coleta não significa que o órgão atualizou o conteúdo naquele momento.

## Mapa dos chunks

Cada arquivo em `painel-cidadao/data/chunks/*.json` vem de uma fonte específica, processada por um coletor Python.

| Chunk | Fonte oficial | Coletor | Atualiza |
|-------|---------------|---------|----------|
| `prefeitura.json` | [Betha — Prefeitura](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==) | `coletor_betha.py` | Diário |
| `camara_anos.json` | [Betha — Câmara](https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324812) | `coletor_betha.py` | Diário |
| `camara_betha.json` | Betha — Câmara | `coletor_betha.py` | Diário |
| `camara_transparencia.json` | Site da Câmara | `coletor_camara_transparencia.py` | Quando muda |
| `emendas.json` | [SAPL Câmara](https://sapl.varginha.mg.leg.br/) | `coletor_emendas_2026.py` + manual | Mensal |
| `diarias.json` | Betha (consulta 83059) | `coletor_betha.py` | Diário |
| `pessoal.json` | Betha (folha de pagamento) | `coletor_pessoal.py` | Conforme disp. |
| `remuneracao_vereadores.json` | [Lei Ordinaria 7.285/2024](https://www.varginha.mg.gov.br/portal/leis_decretos/39702/) + Betha Camara | manual auditado | Revisar quando houver lei/revisao |
| `vereadores.json` | SAPL + manual | `coletor.py` | Anual |
| `cnpjs.json` | [Casa dos Dados](https://casadosdados.com.br/) + Receita Federal | `coletor_cnpj.py` | Sob demanda |
| `pncp.json` | [PNCP](https://pncp.gov.br/) | `coletor_pncp.py` | Mensal |
| `sancoes_fornecedores.json` | [CEIS/CNEP](https://portaldatransparencia.gov.br/sancoes/consulta) + dados.gov.br | futuro coletor | Sob demanda |
| `federal.json` | Portal da Transparência Federal | `coletor_federal.py` | Mensal |
| `resumo.json` | Calculado a partir de outros chunks | `coletor.py` | A cada coleta |
| `auditoria_dados.json` | Auditoria automatica dos chunks publicados | `scripts/audit-data-quality.mjs` | A cada validacao/release |
| `atualizacoes.json` | Índice do feed de atualizações | `coletor.py` | A cada coleta |
| `fontes_emendas_2026.json` | Múltiplas fontes (em construção) | `coletor.py` | Sob demanda |
| `indice_relevancia.json` | Calculado a partir do SAPL em `camara_anos.json` | `scripts/generate-indice-relevancia.mjs` | A cada coleta/release |
| `diario.json` | Diário Oficial do Município | manual (futuro) | Diário |
| `atualizado_em.json` | Timestamp da última coleta | `coletor.py` | A cada coleta |

---

## API REST do Portal Betha

O Betha é a fonte mais rica. Endpoints usados pelos coletores:

Na ficha de um contrato, um documento pode aparecer como um botão **“Link”** em “Documentos relacionados”, sem um endereço visível terminado em `.pdf`. O identificador do arquivo deve ser associado à ficha e consultado na Betha no momento do acesso: o endereço final pode ser temporário. Ausência de extensão `.pdf` no link não comprova ausência de documento; o formato e o vínculo precisam ser verificados na fonte. Se a consulta for inconclusiva, preservar essa situação e orientar a abertura da ficha oficial.

### Regras permanentes para contratos e aditivos

- Consultar a lista de documentos relacionados mesmo quando o acesso aparece como botão “Link”; registrar fonte, ficha, identificador e data. Não armazenar links assinados temporários como endereço permanente.
- Resposta ausente, erro ou consulta inconclusiva não comprovam ausência de documento ou de aditivo. Preservar a última evidência e registrar a tentativa mais recente.
- Pesquisar fontes complementares, inclusive PNCP e Diário Oficial. Um extrato ou lista de alterações não substitui o termo integral; nem toda alteração é um aditivo. Identificar a origem de cada documento.
- Não vincular contratos somente por número e ano: verificar órgão, fornecedor, identificadores e datas; tratar ambiguidades como pendentes e conferir o conteúdo antes de afirmar que o vínculo está comprovado.
- No PNCP, usar `valorGlobal` para valor global, manter `valorInicial` separado e não substituir valor global ausente por zero ou preço inicial. Valores contratuais não são pagamentos comprovados.
- Não somar registros da Betha e PNCP como contratos distintos sem verificação de identidade: a mesma contratação pode constar nas duas fontes. Somas por fonte também podem conter registros duplicados.
- As regras registradas aqui orientam manutenção e auditoria; sua aplicação em cada coleta depende do código, dos testes e das fontes acessíveis. Consultar a [auditoria e seus limites](auditorias/2026-10-29-auditoria-contratos-fontes.md).

As rotinas `coletar-pncp-historico.py` e `coletar-documentos-pncp.py` consultam períodos anteriores e documentos em rodízio. O período da consulta se refere à publicação no PNCP; resposta vazia ou parcial não certifica ausência de contrato. `conferir-documentos-pncp.py` lê uma amostra com limites de tamanho e páginas; quando não há texto extraível, o OCR opcional examina apenas as duas primeiras páginas. Encontrar texto de número e fornecedor é triagem, não confirmação automática de autenticidade, tipo ou vínculo. Falhas preservam a última evidência e a tentativa inconclusiva é registrada.

`extrair-diario-contratos.py` consulta os PDFs no endereço oficial com identificação do projeto, usa arquivo temporário, limita tamanho a 64 MB e 500 páginas e busca referências e fornecedor no mesmo extrato. Apresenta somente associação candidata e a página, sem expor o texto integral no painel. Falhas de acesso ou PDFs sem texto são inconclusivos. `auditar-documentos-contratos.py` preserva empenhos explicitamente informados na ficha: empenho, liquidação, pagamento, fiscalização e entrega são etapas distintas; lista vazia ou campo ausente não comprova inexistência em outra fonte.

`conferir-execucao-contratos.py` consulta a execução detalhada da Betha para um empenho previamente listado na ficha. A associação exige identificação única, entidade, número e ano, data, valor, raiz de CNPJ, nome compatível e número de contrato na própria execução. Apenas campos necessários das liquidações, pagamentos e documentos fiscais são publicados; dados bancários e CPFs não são copiados. Os valores e registros são informados pela fonte, não substituem comprovantes integrais nem demonstram entrega. Uma resposta ambígua ou falha permanece inconclusiva.

O resultado consultado pode ser apresentado para investigação com aviso de vínculo não confirmado e motivo limitado aos critérios divergentes. Em 29/10/2026 foram reexaminados 39 casos; veja a [auditoria das divergências](auditorias/2026-10-29-divergencias-empenhos.md). Nomes de medicamentos não devem ser classificados como documentos de medição.

```
GET https://e-cidade.betha.cloud/transparencia-api/api/consulta-publica/{ID_CONSULTA}/dados
    ?ano={ANO}&limit=1000&offset={N}
```

### IDs de consulta descobertos

**Prefeitura** (portal hash: `y7mn01LGqd_HCvGtj6VPwA==`)

| ID | O que retorna |
|----|---------------|
| 41030 | Despesas (empenhos, liquidações, pagamentos) |
| 41031 | Receitas |
| 41024 | Contratos vigentes |
| 41048 | Licitações |
| 83020 | Tabela detalhada de obras |
| 83026 | Obras públicas |
| 83059 | Diárias |
| 83022 | Inexigibilidade |
| 83062 | Dispensa de licitação |
| varia | Pessoal (depende do mês de competência) |

**Câmara** (portal hash: `-iAWLe1kr2VQcrW9k2AUBg==`)

| ID | O que retorna |
|----|---------------|
| 324812 | Contratos da Câmara |
| Outras | Folha + diárias (ver `coletor_betha.py`) |

### Autenticação

OAuth implícito — token JWT cacheado em `private/tokens/.betha-token.json` (válido ~30 min). Coletor renova automaticamente.

**IMPORTANTE:** o portal **mascara os 4 últimos dígitos do CNPJ** por LGPD (`12.345.678/0001-**`). Cruzamentos usam apenas a **raiz** (8 primeiros dígitos).

---

## Validações que o painel faz

### Auditoria automatica da coleta

O comando `npm run data:audit` gera `auditoria_dados.json` e atualiza o manifesto. Ele nao substitui a validacao estrutural; serve para expor qualidade e limites da coleta:
- base principal defasada;
- fontes com `status: erro`;
- bases declaradamente parciais;
- ranking parlamentar com cobertura menor que 100%;
- diario oficial defasado;
- fornecedores da Camara sem contrato vinculado automaticamente;
- falhas auxiliares de CNPJ.

O comando `npm run validate:data` roda essa auditoria antes da validacao estrutural. Avisos nao impedem a publicacao, mas devem aparecer na metodologia e orientar conferencia antes de divulgacao publica.

### Criterios do "Auditometro" (contratos)

Pontua de 0 a 100 baseado em:
- ✓ Objeto com ≥25 caracteres
- ✓ Valor positivo (`> 0`)
- ✓ Data de assinatura preenchida
- ✓ Data de fim preenchida

**Não avalia legalidade** — apenas completude documental.

### Cruzamento CNPJ (Câmara × Prefeitura)

Para cada contrato da Prefeitura:
1. Pega raiz CNPJ (8 dígitos)
2. Procura em `emendas.json` se há emenda com mesma raiz
3. Se sim, exibe banner amarelo no card

Pré-requisito: o CNPJ não pode estar mascarado (`*` na string).

### Índice de Relevância Parlamentar

O chunk `indice_relevancia.json` é derivado de `camara_anos.json` e não substitui a conferência da fonte primária. A primeira versão usa dimensões com fonte automatizada no SAPL:
- legislar: projetos de lei e emendas;
- fiscalizar: requerimentos;
- representar: só pontua quando houver indicação com atendimento/resposta comprovada;
- simbólico: registrado para transparência, mas com peso zero.

Indicações apenas protocoladas aparecem como evidência, mas não pontuam como resultado até haver confirmação. Presença em sessões, presença em comissões, relatorias, audiências de contas, ofícios de fiscalização, audiência pública/diligência e alterações legislativas relevantes ficam marcadas como pendências auditáveis até haver coleta confiável em atas ou fonte estruturada. Por isso, a nota publicada informa a cobertura automática da metodologia.

O mesmo chunk também publica:
- confiança/cobertura dos dados usados na nota;
- explicação textual do que puxou cada nota para cima ou para baixo;
- rankings por perfil: geral, legislador, fiscalizador, simbólico e efetividade.

O perfil "efetividade" fica vazio até haver evidência oficial de resultado, como indicação atendida, emenda executada, resposta completa ou problema resolvido.

### Detector de fragmentação

Algoritmo em `relatorios.html`:
1. Filtra contratos com valor < R$ 17.600 (limite de dispensa, Lei 14.133/2021)
2. Agrupa por contratado + mês (`YYYY-MM` de `data_assinatura`)
3. Sinaliza grupos com 3+ contratos cuja soma > R$ 17.600

**Não é prova de irregularidade** — é o padrão que o TCE procura em fiscalizações.

---

## Disclaimers obrigatórios

Em qualquer comunicação que use dados do painel:

1. **"Não é prova de irregularidade"** — o painel mostra dados oficiais com triagem automática.
2. **Conferir fonte primária** antes de divulgar.
3. **Citar a data da coleta** (campo `atualizado_em` em todo chunk).
4. **CNPJ mascarado** — cruzamentos podem ter falsos positivos (mesma raiz CNPJ ≠ mesma empresa em filiais).

---

## Quando o Betha mudar a API

A API Betha não tem contrato público. **Vai mudar** sem aviso eventualmente. Indicadores de quebra:

- Coletor falha com `HTTP 401/403` → token expirou ou OAuth mudou
- Coletor falha com `HTTP 404` → ID de consulta mudou
- JSON retornado tem chaves diferentes → endpoint reformulado
- `atualizado_em` antigo demais → coleta parou de rodar

**Plano de manutenção:**
1. Manter dados anteriores como fallback (`coletor` não sobrescreve se erro)
2. Alertar via painel: card vermelho mostrando "Dados podem estar desatualizados — última coleta há X dias"
3. Investigar URL no DevTools do browser navegando o portal Betha manualmente

---

## Como adicionar uma fonte nova

Exemplo: integrar SIOPE (Educação) ou SIOPS (Saúde).

1. **Criar `coletor_siope.py`** seguindo padrão dos existentes:
   ```python
   from pathlib import Path
   ROOT = Path(__file__).resolve().parent
   OUT_PATH = ROOT / "data" / "siope.json"

   def coletar():
       # fetch da API
       # normaliza
       # salva em OUT_PATH
       ...

   if __name__ == "__main__":
       coletar()
   ```

2. **Adicionar ao `coletor.py`** (orquestrador):
   ```python
   from coletor_siope import coletar as coletar_siope
   coletar_siope()
   ```

3. **Adicionar ao `coletor.py`:**
   - Salvar o novo arquivo com `_save("siope.json", dados)`.
   - Incluir a chave em `_save_data_js(...)` se ela também precisar funcionar no fallback `file://`.
   - Adicionar o nome do arquivo à lista de chunks dentro de `_save(...)`, para ele ser replicado em `data/chunks/`.

4. **Mapear no `data-loader.js`** quais páginas precisam:
   ```js
   "relatorios": [..., "siope"],
   ```

5. **Documentar aqui** nessa tabela.

6. **Renderizar no painel** (em `app.js` ou novo módulo `modules/render-siope.js`).

7. **Adicionar smoke test.**

---

## Fontes auxiliares (cruzamento)

| Fonte | Para que serve |
|-------|----------------|
| [Casa dos Dados](https://casadosdados.com.br/) | Situação cadastral do CNPJ (ativo/baixado), sócios, abertura |
| [Receita Federal](https://servicos.receita.fazenda.gov.br/) | Mesmas info, fonte oficial primária |
| [PNCP](https://pncp.gov.br/) | Licitações de todo país (validar nº contrato) |
| [TCE-MG](https://www.tce.mg.gov.br/) | Auditorias e contas anuais |
| [Fiscalizando com TCE](https://fiscalizandocomtce.tce.mg.gov.br/) | Balanço consolidado de Varginha |
| [Portal da Transparência Federal](https://portaldatransparencia.gov.br/) | Transferências da União ao município |
