#!/usr/bin/env node
/**
 * cnpj-enrich.mjs — FERRAMENTA STANDALONE (não plugada no pipeline).
 *
 * Enriquece CNPJs com QSA (sócios), data de abertura e CNAE via BrasilAPI,
 * computa "sinais para conferir" e imprime um resumo. NÃO grava chunk servido
 * nem é chamada por update-data.ps1 — é o passo de prova/coleta manual do
 * cruzamento por CNPJ (ver docs/fontes-dados.md, cruzamento #1).
 *
 * Princípio: SINAL a verificar, nunca acusação. LGPD: não imprime CPF.
 *
 * Uso:
 *   node scripts/cnpj-enrich.mjs 00708912000112 01355795000113
 *   node scripts/cnpj-enrich.mjs --file cnpjs.txt   (um CNPJ por linha)
 *   node scripts/cnpj-enrich.mjs --json out.json 00708912000112
 *
 * Cache em private/cnpj-cache.json (gitignored) para não repetir chamadas.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CACHE_PATH = path.join(ROOT, "private", "cnpj-cache.json");
const UA = "FiscalizaVarginha/1.0 (transparencia civica; uso nao comercial)";
const ENDPOINT = (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`;

const args = process.argv.slice(2);
let outJson = null;
const cnpjs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--file") { cnpjs.push(...fs.readFileSync(args[++i], "utf8").split(/\r?\n/)); }
  else if (args[i] === "--json") { outJson = args[++i]; }
  else cnpjs.push(args[i]);
}
const limpos = [...new Set(cnpjs.map((c) => (c || "").replace(/\D/g, "")).filter((c) => c.length === 14))];
if (!limpos.length) { console.error("Sem CNPJs validos. Uso: node scripts/cnpj-enrich.mjs <cnpj> [...]"); process.exit(2); }

const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const anos = (d) => (d ? (Date.now() - new Date(d).getTime()) / (365.25 * 864e5) : null);

async function buscar(c) {
  if (cache[c]) return cache[c];
  const r = await fetch(ENDPOINT(c), { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) return { erro: `HTTP ${r.status}` };
  const j = await r.json();
  const dado = {
    cnpj: c,
    razao_social: j.razao_social || null,
    abertura: j.data_inicio_atividade || null,
    municipio: j.municipio || null,
    uf: j.uf || null,
    cnae: j.cnae_fiscal || null,
    cnae_desc: j.cnae_fiscal_descricao || null,
    capital_social: j.capital_social ?? null,
    socios: (j.qsa || []).map((s) => s.nome_socio || s.nome).filter(Boolean), // nomes (público no QSA); sem CPF
  };
  cache[c] = dado;
  return dado;
}

(async () => {
  const enriquecidos = [];
  for (const c of limpos) {
    const d = await buscar(c);
    if (d.erro) { console.log(`${c}  ->  ${d.erro}`); continue; }
    const idade = anos(d.abertura);
    d.sinais = [];
    if (idade != null && idade < 0.5) d.sinais.push("empresa aberta ha menos de 6 meses");
    if ((d.socios || []).length === 0) d.sinais.push("sem QSA publico");
    enriquecidos.push(d);
    console.log(
      `${(d.razao_social || "?").slice(0, 44).padEnd(44)} | ${idade != null ? idade.toFixed(1) + "a" : "?"} | ${d.municipio || "?"}/${d.uf || "?"} | socios:${(d.socios || []).length}` +
      (d.sinais.length ? `  [SINAL] ${d.sinais.join("; ")}` : "")
    );
    if (!cache[c] || true) await sleep(350); // respeita a API
  }

  // Cruzamento: socios que aparecem em mais de um fornecedor
  const idx = {};
  enriquecidos.forEach((d) => (d.socios || []).forEach((s) => (idx[s] = idx[s] || []).push(d.cnpj)));
  const comuns = Object.entries(idx).filter(([, v]) => v.length > 1);
  console.log(`\n[CRUZAMENTO] socios em >1 fornecedor: ${comuns.length ? comuns.map(([s, v]) => `${s} (${v.length})`).join("; ") : "nenhum nesta lista"}`);

  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 0));
  if (outJson) { fs.writeFileSync(outJson, JSON.stringify(enriquecidos, null, 2)); console.log(`\nGravado: ${outJson} (${enriquecidos.length} registros)`); }
})();
