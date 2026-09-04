#!/usr/bin/env node
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const painel = path.join(root, "painel-cidadao");
const limites = {
  "app.js": 500_000,
  "style.css": 350_000,
  "data/chunks/home_resumo.json": 8_000,
};
const erros = [];

for (const [relativo, limite] of Object.entries(limites)) {
  const arquivo = path.join(painel, relativo);
  if (!fs.existsSync(arquivo)) {
    erros.push(`${relativo}: ausente`);
    continue;
  }
  const bytes = fs.statSync(arquivo).size;
  console.log(`${relativo}: ${bytes.toLocaleString("pt-BR")} bytes (limite ${limite.toLocaleString("pt-BR")})`);
  if (bytes > limite) erros.push(`${relativo}: ${bytes} > ${limite} bytes`);
}

const loader = fs.readFileSync(path.join(painel, "data-loader.js"), "utf8");
const config = (name) => {
  const match = loader.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\});`));
  if (!match) throw new Error(`Plano de carregamento ausente: ${name}`);
  return vm.runInNewContext(`(${match[1]})`, Object.create(null), { timeout: 1000 });
};
const pages = config("CHUNKS_POR_PAGINA");
const phase2 = config("CHUNKS_FASE2");
const onDemand = config("CHUNKS_SOB_DEMANDA");
const slim = config("ARQUIVO_ENXUTO");
const pageFiles = config("ARQUIVOS_POR_PAGINA");
const manifest = JSON.parse(fs.readFileSync(path.join(painel, "data/manifest.json"), "utf8"));
const pageLimits = { home: 1_200_000, prefeitura: 6_500_000, camara: 5_000_000, relatorios: 5_200_000, atualizacoes: 2_000_000 };
for (const [page, limit] of Object.entries(pageLimits)) {
  const deferred = new Set([...(phase2[page] || []), ...(onDemand[page] || [])]);
  const initial = pages[page].filter(key => !deferred.has(key));
  let bytes = 0;
  for (const key of initial) {
    const file = pageFiles[page]?.[key] || slim[key] || key;
    const entry = manifest.chunks[file];
    if (!entry) erros.push(`${page}: arquivo inicial ausente ${file}`);
    else bytes += entry.bytes;
  }
  console.log(`${page}: ${bytes.toLocaleString("pt-BR")} bytes de JSON inicial (limite ${limit.toLocaleString("pt-BR")})`);
  if (bytes > limit) erros.push(`${page}: JSON inicial ${bytes} > ${limit}`);
}

if (erros.length) {
  console.error("\nOrçamento de desempenho reprovado:");
  erros.forEach((erro) => console.error(`- ${erro}`));
  process.exit(1);
}
console.log("Orçamento de desempenho aprovado.");
