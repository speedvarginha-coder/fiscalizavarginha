// Trava de XSS do chat com IA.
//
// A resposta da IA e conteudo NAO confiavel: o cidadao influencia o texto pelo
// prompt e o resultado vai para innerHTML. Ate 21/08/2026 os links eram
// montados como HTML ANTES do escape e reinjetados DEPOIS, entao rotulo e URL
// nunca eram escapados: `[<img src=x onerror=alert(1)>](https://ok)` executava
// e uma aspa na URL abria atributo novo.
//
// A invariante cobrada nao e "a string X nao aparece" — texto escapado pode
// conter qualquer coisa sem perigo. E: a saida so pode conter as tags e os
// atributos que o proprio renderizador emite.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const FONTE = path.join(RAIZ, "..", "painel-cidadao", "modules", "chat-cidadao.js");

const TAGS_PERMITIDAS = new Set(["a", "strong", "em", "li", "ul", "br", "/a", "/strong", "/em", "/li", "/ul"]);
const ATRIBUTOS_PERMITIDOS = new Set(["href", "target", "rel"]);

// O modulo e uma IIFE que toca document/window no topo. Extrai so as funcoes
// puras de renderizacao e avalia isoladas — sem DOM, sem navegador.
function carregarRenderizador() {
  const src = fs.readFileSync(FONTE, "utf8");
  const trechos = ["function esc(", "function urlSegura(", "function renderMarkdown("]
    .map((assinatura) => {
      const inicio = src.indexOf(assinatura);
      assert.ok(inicio >= 0, `nao achei ${assinatura} em chat-cidadao.js`);
      const fim = src.indexOf("\n  }", inicio); // todas moram no mesmo nivel da IIFE
      assert.ok(fim > inicio, `nao achei o fim de ${assinatura}`);
      return src.slice(inicio, fim + 4);
    })
    .join("\n");
  const fabrica = new Function("window", `${trechos}\nreturn { renderMarkdown };`);
  return fabrica({ location: { href: "https://fiscalizavarginha.com.br/" } });
}

const { renderMarkdown } = carregarRenderizador();

// Devolve lista de problemas: tag fora da allowlist ou atributo fora dela.
function tagsIndevidas(html) {
  const problemas = [];
  for (const [, corpo] of html.matchAll(/<([^>]*)>/g)) {
    const cru = corpo.trim();
    const fechamento = cru.startsWith("/");
    const nome = (fechamento ? cru.slice(1) : cru).trim().split(/[\s/]+/)[0].toLowerCase();
    const tag = fechamento ? `/${nome}` : nome;
    if (!TAGS_PERMITIDAS.has(tag)) {
      problemas.push(`tag <${corpo}>`);
      continue;
    }
    // Remove os valores entre aspas ANTES de procurar nome de atributo. O
    // navegador so fecha o atributo numa aspa literal: `&quot;` dentro do valor
    // e entidade, nao delimitador. Sem isso o teste acusaria XSS onde a URL
    // apenas contem texto escapado.
    const semValores = cru.replace(/"[^"]*"/g, '""');
    for (const [, atributo] of semValores.matchAll(/([a-zA-Z-]+)\s*=/g)) {
      if (!ATRIBUTOS_PERMITIDOS.has(atributo.toLowerCase())) {
        problemas.push(`atributo ${atributo} em <${corpo}>`);
      }
    }
  }
  return problemas;
}

const casos = [
  ["HTML cru no rotulo do link", "veja [<img src=x onerror=alert(1)>](https://ok.com)"],
  ["aspa dupla na URL", 'veja [aqui](https://ok.com" onmouseover="alert(1))'],
  ["aspa simples na URL", "veja [aqui](https://ok.com' onmouseover='alert(1))"],
  ["aspa dupla colada na URL", 'veja [aqui](https://ok.com"onmouseover="alert(1))'],
  ["tag solta no corpo", "<script>alert(1)</script>"],
  ["iframe no corpo", "<iframe src=//evil.tld></iframe>"],
  ["javascript: como link", "[clique](javascript:alert(1))"],
  ["data: como link", "[clique](data:text/html,<script>alert(1)</script>)"],
  ["negrito com tag dentro", "**<img src=x onerror=alert(1)>**"],
  ["item de lista com tag", "- <img src=x onerror=alert(1)>"],
];

let falhas = 0;
for (const [nome, entrada] of casos) {
  const saida = renderMarkdown(entrada);
  const problemas = tagsIndevidas(saida);
  if (problemas.length) {
    console.error(`FALHOU ${nome}\n  ${problemas.join("\n  ")}\n  saida: ${saida}`);
    falhas++;
  } else {
    console.log(`ok  ${nome}`);
  }
}

// Trava que inutiliza o chat nao sobrevive ao proximo desenvolvedor: link
// legitimo tem que continuar clicavel.
const bom = renderMarkdown("fonte: [Portal](https://varginha.mg.gov.br/portal)");
assert.match(bom, /<a href="https:\/\/varginha\.mg\.gov\.br\/portal"/, "link http(s) legitimo sumiu");
assert.match(bom, />Portal<\/a>/, "rotulo do link legitimo sumiu");
assert.deepEqual(tagsIndevidas(bom), [], "link legitimo gerou tag/atributo fora da allowlist");
console.log("ok  link http(s) legitimo continua clicavel");

if (falhas) {
  console.error(`\n${falhas} vetor(es) de XSS passaram.`);
  process.exit(1);
}
console.log("\ntudo passou");
