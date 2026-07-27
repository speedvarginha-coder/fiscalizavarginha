#!/usr/bin/env node
import fs from "node:fs";
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
if (!loader.includes('"home": ["prefeitura"]')) {
  erros.push("prefeitura.json precisa permanecer na fase 2 da home");
}
if (!loader.includes('"home_resumo"')) {
  erros.push("home_resumo não está no carregamento inicial da home");
}
for (const inexistente of ["educacao", "licitacoes", "convenios", "obras_educacao"]) {
  const padrao = new RegExp(`"relatorios"\\s*:\\s*\\[[^\\]]*"${inexistente}"`);
  if (padrao.test(loader)) erros.push(`relatórios ainda requisita chunk inexistente: ${inexistente}`);
}

if (erros.length) {
  console.error("\nOrçamento de desempenho reprovado:");
  erros.forEach((erro) => console.error(`- ${erro}`));
  process.exit(1);
}
console.log("Orçamento de desempenho aprovado.");
