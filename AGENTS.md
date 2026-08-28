# Fiscaliza Varginha — instruções do projeto

Painel cidadão independente de fiscalização da Prefeitura e da Câmara Municipal
de Varginha-MG. Dados extraídos de portais oficiais (Betha, SAPL, PNCP, CGU,
TSE, Transferegov, Diário Oficial) e apresentados em linguagem comum, com
triagem automática de sinais de atenção.

**O produto é `painel-cidadao/`.** HTML/CSS/JS vanilla, sem build step, servido
na Hostinger. Tudo o mais no repositório existe para alimentar, validar ou
publicar essa pasta.

---

## A regra que manda em tudo

> **Nunca afirmar o que a fonte não diz.**

Isto não é aspiração de README: está codificado em testes que reprovam o build.
Antes de mudar qualquer cálculo, lembre-se do que já deu errado aqui:

- Uma folha de vários meses foi publicada como custo mensal (R$ 914 mi,
  303.818 "servidores"). Hoje, sem competência carimbada, os campos mensais
  saem **nulos** e o painel publica a limitação em vez do número.
- Um agregado federal sem repasse individual comprovado virou "recebido
  confirmado". Hoje o estágio fica N/D até haver evidência no próprio dado.
- Um valor bruto pescado do texto do Diário virou R$ 27 mi numa lei de
  doação de R$ 2,4 mi. Hoje o valor da IA tem prioridade e os brutos vão
  marcados como "confira na fonte".

Consequências práticas ao escrever código:

- Dado ausente vira `null` e uma frase explicando, **nunca** `0`, `—` ou
  omissão silenciosa.
- Zero e desconhecido são coisas diferentes. Não os junte no mesmo campo.
- Indicado, empenhado, liquidado, pago e executado são estágios distintos.
- Fonte vazia **preserva a base anterior**; não sobrescreve com vazio.
- Sinal de atenção não é acusação. O texto diz o que verificar, não o que
  concluir.
- CPF não aparece em lugar nenhum, mesmo já vindo mascarado da fonte.

---

## Comandos

```bash
npm test                  # suíte Playwright completa
npm run test:pipeline     # testes Python dos coletores
npm run validate:data     # schema + auditoria + snapshots + números publicados
npm run release           # valida dados, testa, empacota e valida o pacote
npm run data:frescor      # há quanto tempo a coleta não roda
npm run data:saude        # saúde do pipeline (usa private/, local)
npm run data:bundle       # regenera data/manifest.json a partir dos chunks
```

Coleta e publicação (**só Windows**, precisam de tokens em `private/`):

```powershell
npm run data:update           # coleta + valida + empacota
npm run data:schedule:daily   # instala a tarefa diária
npm run deploy:zip            # gera dist/fiscaliza-varginha-painel.zip
```

---

## Armadilhas conhecidas

**Escrita de JSON.** Sempre `newline="\n"`. O manifesto guarda tamanho e SHA-256
de cada chunk; escrever em modo texto no Windows gera CRLF, o git normaliza para
LF ao commitar e o portão de schema reprova em qualquer checkout Linux. Isso
manteve o CI vermelho por 75 execuções seguidas. O `.gitattributes` é a segunda
linha de defesa — não remova o `*.json -text`.

**Container queries no ranking de diárias.** As linhas reagem à largura do
*painel*, não da janela: com dois painéis lado a lado cada um fica em ~556px, e
media queries de viewport davam a resposta errada. Se mexer, confira a
especificidade — `> *` não soma especificidade e perde para `.pai .filho`.

**`data.js` é gitignorado.** É o fallback de `file://`, gerado pelo coletor.
Scripts não podem exigir a presença dele para rodar.

**Testes leem os chunks do disco.** Os testes de integridade não sobem
navegador: mudar um chunk pode reprovar `calculos.spec.js` sem tocar em código.

---

## Estrutura

```
painel-cidadao/        produto publicado (13 páginas + portal de emendas)
  modules/             16 módulos JS, expostos em window.FISCALIZA.*
  data/chunks/         33 JSONs servidos por domínio
  coletor*.py          coletores por fonte
scripts/               validação, geração, release (Node + PowerShell)
tests/                 150 blocos de teste (Playwright + Node + unittest)
docs/                  arquitetura, fontes, automação, publicação
```

Três interfaces alternativas convivem no repositório e **não** são publicadas:
`painel-v2/` (proposta de redesenho), `dashboard/` (laboratório React/Vite) e o
portal `painel-cidadao/emendas/` (dados próprios, gerados em 20/06/2026, que
este sim entra no pacote). Ao corrigir um bug de leitura de dado, verifique se
ele existe também nas outras.

---

## Antes de publicar

`npm run release` roda a cadeia inteira. Além dele:

- Conferir o dado na fonte primária antes de divulgar qualquer número.
- Se a auditoria acusar fonte defasada ou cruzamento incompleto, o aviso ao
  cidadão **continua no ar**. Dado útil para fiscalização não é dado definitivo.

---

## Opensquad

Este repositório também tem o Opensquad instalado (`_opensquad/`, `squads/`,
`skills/`) — um framework de orquestração de agentes de conteúdo, sem relação
com o painel. Use `/opensquad` para ele. Nada em `_opensquad/core/` deve ser
editado à mão.
