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
const prefeituraPath = path.join(chunksDir, "prefeitura.json");
const homeResumoPath = path.join(chunksDir, "home_resumo.json");

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
  "monitoramento_coletas",
  "cnpjs",
  "status_fontes",
  // sem isto o fallback data.js (file:// ou fetch falhando) servia a folha
  // antiga, com 388 "servidores" e o custo de sete meses somado
  "pessoal",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeFileWithRetry(filePath, content) {
  const retryableCodes = new Set(["EBUSY", "EPERM", "EACCES", "UNKNOWN"]);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.writeFileSync(filePath, content, "utf8");
      return;
    } catch (error) {
      if (!retryableCodes.has(error?.code) || attempt === 7) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 125 * (attempt + 1));
    }
  }
}

function parseDataJs(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("data.js sem objeto JSON reconhecivel");
  return JSON.parse(text.slice(start, end + 1));
}

function gerarResumoHome(prefeitura) {
  const contratos = Array.isArray(prefeitura.contratos) ? prefeitura.contratos : [];
  const obras = Array.isArray(prefeitura.obras_publicas) ? prefeitura.obras_publicas : [];
  const emendas = Array.isArray(prefeitura.emendas_cruzadas) ? prefeitura.emendas_cruzadas : [];
  const anoAtual = String(prefeitura.ano_atual || "");
  const anoAnterior = String(prefeitura.ano_anterior || "");
  const contratosPorAno = (ano) => contratos.filter((item) => String(item?.ano || "") === ano).length;
  const fonteBytes = fs.readFileSync(prefeituraPath);
  return {
    schema_version: 1,
    gerado_em: new Date().toISOString(),
    fonte: "data/chunks/prefeitura.json",
    fonte_sha256: crypto.createHash("sha256").update(fonteBytes).digest("hex"),
    ano_atual: prefeitura.ano_atual,
    ano_anterior: prefeitura.ano_anterior,
    total_externo_atual: Number(prefeitura.total_externo_atual) || 0,
    total_externo_anterior: Number(prefeitura.total_externo_anterior) || 0,
    credores_qtd: Number(prefeitura.credores_qtd) || 0,
    contratos_execucao_qtd: contratos.filter(
      (item) => String(item?.situacao || "").toUpperCase() === "EXECUCAO",
    ).length,
    contratos_total_qtd: contratos.length,
    contratos_ano_atual_qtd: contratosPorAno(anoAtual),
    contratos_ano_anterior_qtd: contratosPorAno(anoAnterior),
    obras_qtd: obras.length,
    sinais_emendas_qtd: emendas.filter((item) => Number(item?.valor_pago_total) > 0).length,
    licitacoes_qtd: Array.isArray(prefeitura.licit_andamento)
      ? prefeitura.licit_andamento.length
      : 0,
  };
}

if (!fs.existsSync(dataJsPath)) {
  throw new Error(`data.js nao encontrado: ${dataJsPath}`);
}

const data = parseDataJs(fs.readFileSync(dataJsPath, "utf8"));
const synced = [];

if (fs.existsSync(prefeituraPath)) {
  writeFileWithRetry(
    homeResumoPath,
    JSON.stringify(gerarResumoHome(readJson(prefeituraPath)), null, 2) + "\n",
  );
}

for (const key of keys) {
  const chunkPath = path.join(chunksDir, `${key}.json`);
  if (!fs.existsSync(chunkPath)) continue;
  data[key] = readJson(chunkPath);
  synced.push(key);
}

writeFileWithRetry(
  dataJsPath,
  "/* Gerado por coletor.py — não editar à mão. */\n"
    + "window.ZELA_DATA = "
    + JSON.stringify(data, null, 2)
    + ";\n",
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
writeFileWithRetry(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`data.js sincronizado: ${synced.join(", ") || "nenhum chunk auxiliar"}`);
