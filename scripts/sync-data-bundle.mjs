#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const painelDir = path.join(root, "painel-cidadao");
const dataJsPath = path.join(painelDir, "data.js");
const chunksDir = path.join(painelDir, "data", "chunks");

const keys = [
  "auditoria_dados",
  "indice_relevancia",
  "remuneracao_vereadores",
  "sancoes_fornecedores",
  "atualizacoes",
  "atualizado_em",
  "diario",
  "mudancas_coleta",
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

console.log(`data.js sincronizado: ${synced.join(", ") || "nenhum chunk auxiliar"}`);
