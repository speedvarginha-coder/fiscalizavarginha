#!/usr/bin/env node
/* Fiscaliza Varginha — guard de sintaxe JS
 *
 * Roda `node --check` em todo JS do painel. Pega a classe de bug que já nos
 * mordeu: identifiers acentuados (ex.: `educação.length`, `${período}`)
 * introduzidos por scripts de tradução, que quebram o parse silenciosamente
 * em produção. Um arquivo que não passa no parser do V8 falha aqui.
 */
import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "painel-cidadao");

function listJs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listJs(full));
    else if (name.endsWith(".js") && name !== "data.js") out.push(full);
  }
  return out;
}

const files = listJs(root);
let fail = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (e) {
    fail++;
    console.error(`SYNTAX FAIL: ${f}\n${(e.stderr || e.stdout || e).toString()}`);
  }
}

if (fail) {
  console.error(`\n${fail} arquivo(s) com erro de sintaxe.`);
  process.exit(1);
}
console.log(`OK — ${files.length} arquivos JS passaram no node --check.`);
