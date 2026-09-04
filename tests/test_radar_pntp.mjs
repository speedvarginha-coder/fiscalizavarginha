/* Trava: os numeros do Radar da Transparencia no index.html precisam continuar
 * descrevendo a base oficial do PNTP/Atricon guardada em data/referencias.
 *
 * O bloco publica indice e nivel escritos a mao no HTML. Numero escrito a mao
 * nao envelhece sozinho: quando a Atricon publicar o ciclo seguinte, alguem
 * troca o arquivo de referencia e a pagina fica dizendo o numero velho com
 * cara de atual. Este teste liga um ao outro — se divergirem, quebra aqui em
 * vez de quebrar na cara do cidadao.
 */
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const html = readFileSync("painel-cidadao/index.html", "utf8");
const fonte = JSON.parse(readFileSync("painel-cidadao/data/referencias/pntp-2025.json", "utf8"));

const bloco = html.slice(html.indexOf('id="radar-transparencia"'), html.indexOf("LINHA DO TEMPO EDUCATIVA"));

const cartoes = {
  prefeitura: { rotulo: 'transp-card__orgao">Prefeitura de Varginha' },
  camara: { rotulo: 'transp-card__orgao">Câmara de Varginha' },
};

test("o indice publicado no Radar e o da base oficial", () => {
  for (const [chave, { rotulo }] of Object.entries(cartoes)) {
    const oficial = fonte.orgaos[chave];
    const trecho = bloco.slice(bloco.indexOf(rotulo));
    const publicado = trecho.match(/class="transp-card__indice">([\d.,]+)/)[1];
    assert.equal(
      publicado,
      oficial.indice.toLocaleString("pt-BR", { maximumFractionDigits: 1 }),
      `${rotulo}: indice publicado (${publicado}) difere da base oficial (${oficial.indice})`,
    );
  }
});

test("o nivel publicado e o da base oficial", () => {
  for (const [chave, { rotulo }] of Object.entries(cartoes)) {
    const oficial = fonte.orgaos[chave];
    const trecho = bloco.slice(bloco.indexOf(rotulo));
    assert.match(trecho.slice(0, 400), new RegExp(`Nível ${oficial.nivel}`));
  }
});

test("os essenciais publicados batem com a base, arredondados", () => {
  for (const [chave, { rotulo }] of Object.entries(cartoes)) {
    const oficial = fonte.orgaos[chave];
    const trecho = bloco.slice(bloco.indexOf(rotulo));
    const publicado = Number(trecho.match(/Itens essenciais:\s*(\d+)%/)[1]);
    assert.equal(publicado, Math.round(oficial.essenciais),
      `${rotulo}: essenciais publicados (${publicado}%) nao batem com ${oficial.essenciais}%`);
  }
});

test("a pagina nao chama de validado o que a fonte diz nao ser", () => {
  for (const orgao of Object.values(fonte.orgaos)) {
    assert.equal(orgao.autoavaliacao, true);
    assert.equal(orgao.validada, false);
    assert.equal(orgao.certificavel, false);
  }
  // O texto do bloco precisa dizer isso ao leitor, nao so guardar no arquivo.
  assert.match(bloco, /não constam como validados ou revisados/i);
  assert.match(bloco, /autoavaliação/i);
});

test("o ciclo publicado e o do arquivo de referencia", () => {
  assert.match(bloco, new RegExp(String(fonte.ciclo)));
});
