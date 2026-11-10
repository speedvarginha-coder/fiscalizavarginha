import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = path.join(root, "private/state/code-baseline.json");
const files = {};
function visit(relative) {
  const absolute = path.join(root, relative);
  if (fs.statSync(absolute).isDirectory()) {
    for (const name of fs.readdirSync(absolute).sort()) {
      if (name.startsWith(".") && name !== ".htaccess") continue;
      if (["data", "data.js", "operacao.json", "__pycache__", "node_modules", "auth_info", "relatorios"].includes(name)) continue;
      visit(`${relative}/${name}`);
    }
  } else if (/\.(?:js|mjs|html|css|php|py|ps1|json)$|\/\.htaccess$/.test(relative)) {
    files[relative] = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
  }
}
for (const relative of ["painel-cidadao", "scripts", "private/deploy_completo.py", "package.json", "package-lock.json"]) visit(relative);
if (process.argv.includes("--record")) {
  fs.mkdirSync(path.dirname(baseline), { recursive: true });
  fs.writeFileSync(baseline, JSON.stringify({ validated_at: new Date().toISOString(), files }, null, 2) + "\n");
  console.log(`Versão de código registrada: ${Object.keys(files).length} arquivos.`);
} else {
  const previous = fs.existsSync(baseline) ? JSON.parse(fs.readFileSync(baseline, "utf8")).files : {};
  const changed = [...new Set([...Object.keys(files), ...Object.keys(previous)])].filter(key => files[key] !== previous[key]);
  if (changed.length) {
    console.error(`Código mudou desde a versão validada (${changed.length} arquivos). Nova validação necessária.`);
    process.exitCode = 1;
  } else console.log("Código corresponde à versão validada; somente dados podem variar.");
}
