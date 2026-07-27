# Matriz de critérios do PNTP 2026

Especificação oficial usada pela Atricon e pelos Tribunais de Contas para avaliar
portais de transparência no Programa Nacional de Transparência Pública (PNTP).

Serve aqui como referência para duas coisas:

1. Conferir o que a Prefeitura e a Câmara de Varginha são obrigadas a publicar
   (e cobrar por LAI o que faltar).
2. Orientar a estrutura do painel, já que os portais bem avaliados são, na
   prática, essa matriz renderizada.

## Arquivos

| Arquivo | O que é |
|---|---|
| `matriz-criterios-2026.xlsx` | Original da Atricon, aba `PNTP - CICLO 2026` |
| `criterios-pntp-2026.csv` | Os 181 critérios extraídos: `matriz`, `dimensao`, `id`, `criterio`, `classe` |

## Origem

Baixado em 25/07/2026 de:

<https://radardatransparencia.atricon.org.br/dados/criterios_de_avaliacao_pntp_2026.zip>

Página de downloads: <https://radardatransparencia.atricon.org.br/downloads.html>

## Como a nota funciona

Índice de 0 a 100%, ponderado por exigibilidade (essencial > obrigatória > recomendada).

Cada critério é pontuado em cinco eixos:

| Eixo | Peso |
|---|---|
| Disponibilidade | 30% |
| Atualidade | 30% |
| Série histórica | 20% |
| Gravação de relatórios | 10% |
| Filtro de pesquisa | 10% |

Faixas:

| Nível | Índice | Exige 100% dos essenciais |
|---|---|---|
| Diamante | 95–100% | sim |
| Ouro | 85–94% | sim |
| Prata | 75–84% | sim |
| Elevado | 75–100% | não |
| Intermediário | 50–74% | não |
| Básico | 30–49% | não |
| Inicial | 1–29% | não |

Base normativa: Resolução Atricon nº 01/2022, que alterou a nº 09/2018.

## Recorte que interessa a Varginha

Dos 181 critérios, **106** se aplicam a Prefeitura e Câmara (matrizes `COMUM`,
`EXECUTIVO`, `PODER LEGISLATIVO` e as variantes `COMUM (EXCETO ESTATAIS...)`).
O restante é de estatais, consórcios, tribunais, Ministério Público e Defensoria.

São **12 os critérios essenciais** — falhar um derruba o selo independentemente
do índice. Quase todos são de dinheiro: receita, despesa, empenho, RGF, RREO,
PPA, LDO e LOA.

O essencial **4.3** é o de maior interesse para o cruzamento por CNPJ que o
painel já faz:

> Possibilita a consulta de empenhos com os detalhes do beneficiário do pagamento
> ou credor, o valor, o bem fornecido ou serviço prestado e a identificação do
> procedimento licitatório originário da despesa?

## Regerar o CSV a partir do xlsx

```bash
py -c "
import openpyxl, csv
wb = openpyxl.load_workbook('matriz-criterios-2026.xlsx', data_only=True)
ws = wb['PNTP - CICLO 2026']
rows = []
for r in range(2, ws.max_row + 1):
    m, d, i, c, cl = [ws.cell(r, x).value for x in (1, 2, 3, 4, 5)]
    if not (i and c):
        continue
    rows.append({'matriz': (m or '').strip(), 'dimensao': (d or '').strip(),
                 'id': str(i).strip(), 'criterio': str(c).strip(),
                 'classe': (cl or '').strip()})
with open('criterios-pntp-2026.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=['matriz', 'dimensao', 'id', 'criterio', 'classe'])
    w.writeheader()
    w.writerows(rows)
print(len(rows), 'critérios')
"
```

## Cuidado ao citar

O ranking replicado em `radartransparente.com.br` **não** é o portal oficial da
Atricon. Para ofício e publicação, citar sempre
<https://radardatransparencia.atricon.org.br/>.
