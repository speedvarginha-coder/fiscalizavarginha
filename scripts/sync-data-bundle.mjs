#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const painelDir = path.join(root, "painel-cidadao");
const dataJsPath = path.join(painelDir, "data.js");
const chunksDir = path.join(painelDir, "data", "chunks");
const manifestPath = path.join(painelDir, "data", "manifest.json");

const keys = [
  "auditoria_dados",
  "indice_relevancia",
  "remuneracao_vereadores",
  "resumo",
  "sancoes_fornecedores",
  "atualizacoes",
  "atualizado_em",
  "camara_betha",
  "diario",
  "fundacao_cultural",
  "mudancas_coleta",
  "cnpjs",
  "status_fontes",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseDataJs(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("data.js sem objeto JSON reconhecivel");
  return JSON.parse(text.slice(start, end + 1));
}

if (!fs.existsSync(dataJsPath)) {
  throw new Error(`data.js nao encontrado: ${dataJsPath}`);
}

const data = parseDataJs(fs.readFileSync(dataJsPath, "utf8"));
const synced = [];

for (const key of keys) {
  const chunkPath = path.join(chunksDir, `${key}.json`);
  if (!fs.existsSync(chunkPath)) continue;
  data[key] = readJson(chunkPath);
  synced.push(key);
}

fs.writeFileSync(
  dataJsPath,
  "/* Gerado por coletor.py — não editar à mão. */\n"
    + "window.ZELA_DATA = "
    + JSON.stringify(data, null, 2)
    + ";\n",
  "utf8",
);

const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : {};
manifest.gerado_em = new Date().toISOString();
manifest.chunks = {};
for (const name of fs.readdirSync(chunksDir).filter((name) => name.endsWith(".json")).sort()) {
  const filePath = path.join(chunksDir, name);
  manifest.chunks[path.basename(name, ".json")] = {
    arquivo: `data/chunks/${name}`,
    bytes: fs.statSync(filePath).size,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
  };
}
const snapshotsDir = path.join(painelDir, "data", "snapshots");
const snapshots = fs.existsSync(snapshotsDir)
  ? fs.readdirSync(snapshotsDir).filter((name) => name.endsWith(".json")).sort()
  : [];
manifest.snapshots = {
  diretorio: "data/snapshots",
  total: snapshots.length,
  ultimo: snapshots.at(-1) || "",
  arquivos: Object.fromEntries(snapshots.map((name) => {
    const filePath = path.join(snapshotsDir, name);
    return [name, {
      bytes: fs.statSync(filePath).size,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
    }];
  })),
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(`data.js sincronizado: ${synced.join(", ") || "nenhum chunk auxiliar"}`);
