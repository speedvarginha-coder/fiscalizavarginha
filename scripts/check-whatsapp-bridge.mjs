#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statePath = path.join(root, "private", "state", "whatsapp_bridge_watchdog.json");
const taskName = "Fiscaliza Varginha - Ponte WhatsApp";
const endpoint = "http://127.0.0.1:8080/";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function probe() {
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(5_000) });
    const html = await response.text();
    const connected = response.ok
      && /bg-success/i.test(html)
      && /Conectado com sucesso!/i.test(html);
    return { ok: connected, http: response.status, detail: connected ? "conectado" : "painel respondeu sem sessao conectada" };
  } catch (error) {
    return { ok: false, http: null, detail: String(error?.message || error) };
  }
}

function writeState(payload) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({
    schema: 1,
    checked_at: new Date().toISOString(),
    ...payload,
  }, null, 2) + "\n", "utf8");
}

let result = await probe();
if (result.ok) {
  writeState({ status: "ok", recovered: false, ...result });
  console.log("Ponte WhatsApp: conectada.");
  process.exit(0);
}

// Confirma a falha antes de interromper qualquer processo. Isso evita reinicio
// por uma unica resposta lenta durante a reconexao interna do Baileys.
await wait(5_000);
result = await probe();
if (result.ok) {
  writeState({ status: "ok", recovered: false, ...result });
  console.log("Ponte WhatsApp: reconectou sozinha na segunda verificacao.");
  process.exit(0);
}

console.warn(`Ponte indisponivel (${result.detail}); reiniciando a tarefa.`);
spawnSync("schtasks.exe", ["/End", "/TN", taskName], { encoding: "utf8", windowsHide: true });
await wait(2_000);
const start = spawnSync("schtasks.exe", ["/Run", "/TN", taskName], { encoding: "utf8", windowsHide: true });
await wait(15_000);
const afterRestart = await probe();

if (afterRestart.ok) {
  writeState({ status: "ok", recovered: true, ...afterRestart });
  console.log("Ponte WhatsApp: recuperada automaticamente.");
  process.exit(0);
}

writeState({
  status: "falha",
  recovered: false,
  restart_exit_code: start.status,
  ...afterRestart,
});
console.error(`Ponte WhatsApp continua indisponivel: ${afterRestart.detail}`);
process.exit(1);
