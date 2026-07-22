#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statePath = path.join(root, "private", "state", "pipeline_last_result.json");
const successPath = path.join(root, "private", "state", "pipeline_last_success.json");
const params = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=")];
}));

const now = new Date();
const payload = {
  schema_version: 1,
  updated_at: now.toISOString(),
  finished_at: params.finished_at || now.toISOString(),
  coleta: params.coleta || "DESCONHECIDO",
  deploy: params.deploy || "PULADO",
  whatsapp: params.whatsapp || "PULADO",
  fase: params.fase || "final",
};

fs.mkdirSync(path.dirname(statePath), { recursive: true });
const tmp = `${statePath}.tmp-${process.pid}`;
fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
fs.renameSync(tmp, statePath);
if (payload.coleta === "SUCESSO") {
  const successTmp = `${successPath}.tmp-${process.pid}`;
  fs.writeFileSync(successTmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(successTmp, successPath);
}
console.log(`Estado do pipeline registrado: coleta=${payload.coleta} fase=${payload.fase}`);
