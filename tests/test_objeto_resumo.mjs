// Resumo do objeto no card de emendas.
//
// A mediana das descricoes e 90 caracteres, mas 86 registros passam de 300 e um
// chega a 1.485, empurrando valores e tags para fora da primeira tela. O card
// resume acima do limite e guarda o texto integral num <details>. Estes testes
// travam o que nao pode regredir: nada some, nada escapa sem escape, e texto
// curto continua sendo um <p> simples.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fonte = fs.readFileSync(
  path.join(raiz, "painel-cidadao", "emendas", "app.js"),
  "utf8",
);

// O app do portal e um script classico sem exports; extraimos as duas funcoes
// puras para exercitar exatamente o codigo publicado, sem duplicar a logica.
function carregarFuncoes() {
  const limite = fonte.match(/const OBJETO_RESUMO_LIMITE = \d+;/);
  const escape = fonte.match(/function escapeHtml\(value\) \{[\s\S]*?\n\}/);
  const resumo = fonte.match(/function resumoObjetoHtml\(objeto\) \{[\s\S]*?\n\}/);
  assert.ok(limite, "OBJETO_RESUMO_LIMITE nao encontrado em emendas/app.js");
  assert.ok(escape, "escapeHtml nao encontrado em emendas/app.js");
  assert.ok(resumo, "resumoObjetoHtml nao encontrado em emendas/app.js");
  return new Function(
    `${limite[0]}\n${escape[0]}\n${resumo[0]}\nreturn { OBJETO_RESUMO_LIMITE, resumoObjetoHtml };`,
  )();
}

const { OBJETO_RESUMO_LIMITE, resumoObjetoHtml } = carregarFuncoes();

test("texto curto continua um paragrafo simples, sem details", () => {
  const curto = "Aquisição de equipamento hospitalar.";
  assert.equal(resumoObjetoHtml(curto), `<p>${curto}</p>`);
});

test("texto no limite exato nao vira resumo", () => {
  const html = resumoObjetoHtml("a".repeat(OBJETO_RESUMO_LIMITE));
  assert.ok(!html.includes("<details"), "nao deveria resumir exatamente no limite");
});

test("texto longo mantem o conteudo integral no DOM", () => {
  const longo = "Aquisição de sistema de mamografia digital. ".repeat(40).trim();
  const html = resumoObjetoHtml(longo);
  assert.ok(html.includes("<details"), "texto longo deveria virar details");
  assert.ok(
    html.includes(`<p class="objeto-resumo__completo">${longo}</p>`),
    "o texto completo precisa continuar no DOM para busca e leitor de tela",
  );
});

test("o resumo nao parte palavra ao meio", () => {
  const longo = "palavra ".repeat(200).trim();
  const html = resumoObjetoHtml(longo);
  const inicio = html.match(/objeto-resumo__inicio">([^<]*)…</)[1];
  assert.ok(inicio.length <= OBJETO_RESUMO_LIMITE, "resumo passou do limite");
  assert.ok(!inicio.endsWith(" "), "resumo terminou em espaco");
  assert.ok(
    longo.startsWith(inicio),
    "o resumo precisa ser um prefixo exato do texto original",
  );
  assert.ok(
    /\bpalavra$/.test(inicio),
    `resumo cortou no meio da palavra: ...${inicio.slice(-20)}`,
  );
});

test("texto sem espaco nenhum ainda e cortado no limite", () => {
  const html = resumoObjetoHtml("x".repeat(900));
  const inicio = html.match(/objeto-resumo__inicio">([^<]*)…</)[1];
  assert.equal(inicio.length, OBJETO_RESUMO_LIMITE);
});

test("HTML da fonte e escapado nos dois lugares", () => {
  const malicioso = `<img src=x onerror=alert(1)> ${"texto ".repeat(100)}`;
  const html = resumoObjetoHtml(malicioso);

  // O que torna o conteudo inerte e a ausencia de < e > vindos da fonte:
  // sem delimitador nao ha tag, e "onerror=..." fica sendo texto visivel.
  // Por isso a checagem e sobre os delimitadores, nao sobre a palavra.
  assert.ok(html.includes("&lt;img"), "conteudo deveria aparecer escapado");

  const marcacaoPropria = /<\/?(details|summary|span|p)(\s[^>]*)?>/g;
  const semMarcacaoPropria = html.replace(marcacaoPropria, "");
  assert.ok(
    !semMarcacaoPropria.includes("<") && !semMarcacaoPropria.includes(">"),
    "sobrou < ou > vindo da fonte depois de remover a marcacao do proprio card",
  );
});

test("valor ausente nao quebra a renderizacao", () => {
  assert.equal(resumoObjetoHtml(null), "<p></p>");
  assert.equal(resumoObjetoHtml(undefined), "<p></p>");
});
