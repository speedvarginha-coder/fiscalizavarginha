# Fontes de dados — Fiscaliza Varginha

De onde vem cada número que aparece no painel. **Sempre** que algo for divulgado publicamente, conferir a fonte oficial primeiro.

---

## Mapa dos chunks

Cada arquivo em `painel-cidadao/data/chunks/*.json` vem de uma fonte específica, processada por um coletor Python.

| Chunk | Fonte oficial | Coletor | Atualiza |
|-------|---------------|---------|----------|
| `prefeitura.json` | [Betha — Prefeitura](https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==) | `coletor_betha.py` | Semanal |
| `camara_anos.json` | [Betha — Câmara](https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324812) | `coletor_betha.py` | Semanal |
| `camara_transparencia.json` | Site da Câmara | `coletor_camara_transparencia.py` | Quando muda |
| `emendas.json` | [SAPL Câmara](https://sapl.varginha.mg.leg.br/) | `coletor_emendas_2026.py` + manual | Mensal |
| `diarias.json` | Betha (consulta 83059) | `coletor_betha.py` | Semanal |
| `pessoal.json` | Betha (folha de pagamento) | `coletor_pessoal.py` | Conforme disp. |
| `vereadores.json` | SAPL + manual | `coletor.py` | Anual |
| `cnpjs.json` | [Casa dos Dados](https://casadosdados.com.br/) + Receita Federal | `coletor_cnpj.py` | Sob demanda |
| `pncp.json` | [PNCP](https://pncp.gov.br/) | `coletor_pncp.py` | Mensal |
| `federal.json` | Portal da Transparência Federal | `coletor_federal.py` | Mensal |
| `resumo.json` | Calculado a partir de outros chunks | `coletor.py` | A cada coleta |
| `fontes_emendas_2026.json` | Múltiplas fontes (em construção) | `coletor.py` | Sob demanda |
| `diario.json` | Diário Oficial do Município | manual (futuro) | Diário |
| `atualizado_em.json` | Timestamp da última coleta | `coletor.py` | A cada coleta |

---

## API REST do Portal Betha

O Betha é a fonte mais rica. Endpoints usados pelos coletores:

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

### Critérios do "Auditômetro" (contratos)

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

3. **Adicionar ao `_split_data.py` ou ao bundle:**
   - Se for chunk novo, adicionar key no `data.js` antes do split.
   - O script `_split_data.py` gera automaticamente `data/chunks/siope.json`.

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
