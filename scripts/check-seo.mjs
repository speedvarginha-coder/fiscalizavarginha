#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "painel-cidadao");
const origin = "https://fiscalizavarginha.com.br";

const indexablePages = new Map([
  ["/", "index.html"],
  ["/atualizacoes.html", "atualizacoes.html"],
  ["/prefeitura.html", "prefeitura.html"],
  ["/fundacao.html", "fundacao.html"],
  ["/camara.html", "camara.html"],
  ["/emendas/", "emendas/index.html"],
  ["/relatorios.html", "relatorios.html"],
  ["/pessoal.html", "pessoal.html"],
  ["/avalie.html", "avalie.html"],
  ["/sobre.html", "sobre.html"],
  ["/conformidade.html", "conformidade.html"],
  ["/cobrar.html", "cobrar.html"],
]);

const privatePages = new Map([
  ["/marcadores.html", "marcadores.html"],
  ["/monitoramento.html", "monitoramento.html"],
]);

const failures = [];
const titles = new Map();

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(publicDir, relativePath), "utf8");
}

function getAttribute(html, selectorPattern, attribute) {
  const tag = html.match(selectorPattern)?.[0] || "";
  return tag.match(new RegExp(`${attribute}=["']([^"']+)["']`, "i"))?.[1] || "";
}

function validatePage(urlPath, relativePath, shouldIndex) {
  const html = read(relativePath);
  const expectedUrl = `${origin}${urlPath}`;
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || "";
  const description = getAttribute(
    html,
    /<meta\s+[^>]*name=["']description["'][^>]*>/i,
    "content",
  );
  const robots = getAttribute(html, /<meta\s+[^>]*name=["']robots["'][^>]*>/i, "content");
  const canonical = getAttribute(html, /<link\s+[^>]*rel=["']canonical["'][^>]*>/i, "href");

  if (!title) fail(`${relativePath}: title ausente`);
  if (title.length > 65) fail(`${relativePath}: title longo demais (${title.length})`);
  if (titles.has(title)) fail(`${relativePath}: title duplicado com ${titles.get(title)}`);
  titles.set(title, relativePath);

  if (!description) fail(`${relativePath}: meta description ausente`);
  if (description.length < 70 || description.length > 170) {
    fail(`${relativePath}: meta description fora da faixa de 70-170 caracteres (${description.length})`);
  }
  if (canonical !== expectedUrl) {
    fail(`${relativePath}: canonical esperado ${expectedUrl}, encontrado ${canonical || "ausente"}`);
  }
  if (!/<h1\b/i.test(html)) fail(`${relativePath}: h1 ausente`);

  if (shouldIndex) {
    if (!robots.includes("index") || robots.includes("noindex")) {
      fail(`${relativePath}: pagina publica sem diretiva index`);
    }
    const ogUrl = getAttribute(html, /<meta\s+[^>]*property=["']og:url["'][^>]*>/i, "content");
    if (ogUrl !== expectedUrl) fail(`${relativePath}: og:url ausente ou divergente`);
  } else if (!robots.includes("noindex")) {
    fail(`${relativePath}: pagina pessoal/tecnica deve usar noindex`);
  }
}

for (const [urlPath, relativePath] of indexablePages) validatePage(urlPath, relativePath, true);
for (const [urlPath, relativePath] of privatePages) validatePage(urlPath, relativePath, false);

const sitemap = read("sitemap.xml");
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const expectedUrls = [...indexablePages.keys()].map((urlPath) => `${origin}${urlPath}`);
for (const url of expectedUrls) {
  if (!sitemapUrls.includes(url)) fail(`sitemap.xml: URL ausente ${url}`);
}
for (const url of sitemapUrls) {
  if (!expectedUrls.includes(url)) fail(`sitemap.xml: URL inesperada ou nao indexavel ${url}`);
  if (!url.startsWith(`${origin}/`)) fail(`sitemap.xml: URL fora do dominio canonico ${url}`);
}
if (new Set(sitemapUrls).size !== sitemapUrls.length) fail("sitemap.xml: URLs duplicadas");

const robots = read("robots.txt");
if (!robots.includes(`Sitemap: ${origin}/sitemap.xml`)) {
  fail("robots.txt: referencia correta ao sitemap ausente");
}

const allSeoText = `${sitemap}\n${robots}`;
if (/SEU-DOMINIO|seudominio/i.test(allSeoText)) {
  fail("Arquivos SEO ainda contem dominio ficticio");
}

const home = read("index.html");
const jsonLdBlocks = [...home.matchAll(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi)];
if (!jsonLdBlocks.length) fail("index.html: dados estruturados JSON-LD ausentes");
for (const [, json] of jsonLdBlocks) {
  try {
    JSON.parse(json);
  } catch (error) {
    fail(`index.html: JSON-LD invalido (${error.message})`);
  }
}

if (failures.length) {
  console.error("Auditoria SEO: FALHOU");
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`Auditoria SEO: OK (${indexablePages.size} paginas indexaveis, ${privatePages.size} com noindex)`);
