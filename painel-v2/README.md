# Painel v2 — "Dinheiro de Varginha"

Versão nova, escrita do zero. **Não altera nada do `painel-cidadao/`.**
É só uma camada de apresentação: lê os mesmos chunks JSON que o coletor já gera,
não coleta nada e não escreve nada.

## Por que existe

O v1 é completo e cobre muita coisa. O v2 aposta em outra hipótese: a maior
parte das pessoas chega ao painel com uma pergunta só na cabeça, e desiste se
não achar a resposta em dois cliques.

O desenho saiu da análise de 27 portais premiados pelo PNTP (Diamante, Ouro e
Prata) feita em 25/07/2026. O que os melhores acertam e quase todos erram está
em `docs/pntp/`. Cinco decisões vieram dali:

1. **Um lugar só.** Nada de jogar o cidadão para outro domínio. O link da fonte
   existe em cada bloco, para conferência, mas o dado é lido aqui.
2. **Número antes do menu.** A primeira coisa da página é quanto foi gasto.
3. **Rótulo é pergunta, não sigla.** "Quanto ganha cada um", não "Padrão
   Remuneratório". "Como cobrar uma resposta", não "e-SIC".
4. **Cinco perguntas na capa.** Salário, gasto, obra parada, viagem, como cobrar.
   São as que as pessoas realmente fazem.
5. **Uma busca só**, varrendo fornecedores, contratos, obras e folha ao mesmo tempo.

O teste que o desenho tenta passar: um jovem de 16 anos entra e acha o que quer
sem saber o que é empenho, competência ou ordem cronológica.

## Rodar

Precisa ser servido por HTTP a partir da **raiz do projeto**, porque o v2 lê os
dados de `../painel-cidadao/data/chunks`.

```bash
npx serve . -l 5556
```

Depois abra <http://localhost:5556/painel-v2/> (com a barra no final).

## Publicar

Uma linha muda. No topo de `assets/app.js`:

```js
var DATA_BASE = "../painel-cidadao/data/chunks";
```

Na Hostinger, onde o conteúdo do `painel-cidadao/` fica na raiz do `public_html`
e o v2 iria para `public_html/v2/`, o valor passa a ser:

```js
var DATA_BASE = "../data/chunks";
```

Nada mais precisa ser tocado.

## Arquivos

```
painel-v2/
├── index.html        estrutura e textos fixos
├── assets/app.css    o desenho inteiro
├── assets/app.js     carregamento, rotas, telas e busca
└── README.md
```

Sem framework, sem build, sem dependência. Igual ao v1 nesse ponto.

## Telas

| Rota | O que responde |
|---|---|
| `#/` | Quanto a cidade gastou este ano, e as cinco perguntas |
| `#/salarios` | Quanto ganha cada servidor e cada vereador |
| `#/dinheiro` | Quem mais recebeu, licitações abertas, maiores contratos |
| `#/obras` | O que está parado, atrasado, em andamento e entregue |
| `#/viagens` | Diárias pagas, com destino e motivo |
| `#/cobrar` | Como pedir informação e o que fazer se não responderem |
| `#/busca/<termo>` | Busca única em fornecedores, contratos, obras e folha |

## Regras que o código respeita de propósito

**Salário nunca aparece sozinho.** Todo valor de folha vem com competência,
vínculo e escopo. Número de folha sem competência engana, porque um mês com
décimo terceiro não é comparável a um mês comum.

**Vereador não é qualquer pessoa lotada na Câmara.** O filtro exige lotação de
vereador e bruto de pelo menos 70% do subsídio legal, senão assessor entraria na
lista.

**Quando o bruto passa do subsídio fixado em lei, o painel mostra a diferença** e
diz que a verba que a compõe não está informada na fonte. Não afirma
irregularidade: aponta a pergunta a fazer.

**Obra atrasada é calculada, não copiada.** Se a data prometida passou e não há
conclusão efetiva, aparece como atrasada mesmo que a fonte ainda diga "em
andamento".

**Data impossível vira aviso, não sumiço.** A fonte tem registro com ano 2102. O
painel mostra a viagem, marca "data errada na fonte" e sugere pedir correção.

**Não afirma o que a fonte não diz.** O campo `registros` dos fornecedores é
linha agregada, não contagem de pagamentos, então o painel escreve "total
consolidado" em vez de inventar quantidade.

**CPF não é exibido em lugar nenhum**, mesmo já vindo mascarado da coleta.

## O que ainda não tem

Consciente, para não inchar antes de validar o desenho:

- Emendas parlamentares e cruzamento por CNPJ (existem no v1)
- Publicações do Diário e da Câmara
- Watchlist, glossário navegável e modo offline por service worker
- Fundação Cultural
- Página de conformidade e relatórios

Se o desenho se provar melhor, esses blocos migram. Se não, nada foi perdido:
o v1 continua intacto e é ele que está publicado.
