#!/usr/bin/env node
// Alerta de operação — separado do canal público (grupo do WhatsApp).
//
// Registra um "batimento cardíaco" a cada disparo do update-data.ps1 (mesmo
// quando o ciclo é pulado por -OnlyIfChanged), e verifica se: (1) a
// automação parou de disparar de verdade (heartbeat velho — Task Scheduler
// quebrado, PC desligado, tarefa desativada), ou (2) a automação dispara mas
// a última coleta bem-sucedida está velha demais (falhas repetidas).
//
// Motivo: entre 17/07 e 20/07/2026 a coleta ficou parada por bugs de
// pipeline e ninguém foi avisado — o usuário descobriu perguntando "tá
// funcionando?". Este script existe para que da próxima vez o alerta chegue
// sozinho, sem precisar perguntar.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const chunksDir = path.join(root, "painel-cidadao", "data", "chunks");
const stateDir = path.join(root, "private", "state");
const heartbeatPath = path.join(stateDir, "pipeline_heartbeat.json");
const alertaPath = path.join(stateDir, "alerta_operacional.json");

const modo = process.argv.includes("--registrar") ? "registrar" : "checar";
const tarefa = (process.argv.find((a) => a.startsWith("--tarefa=")) || "").split("=")[1] || "desconhecida";

// Limites: folgados o bastante para nao alarmar por causa de silencio normal
// das fontes (fim de semana, noite), mas curtos o bastante para pegar uma
// automacao real quebrada em menos de um dia.
const LIMITE_HEARTBEAT_HORAS = 6; // nenhum disparo (nem skip) em 6h = Task Scheduler/PC parado
const LIMITE_SUCESSO_HORAS = 48; // sem NENHUMA coleta bem-sucedida em 48h = falhas repetidas

function readJson(filePath, fallback = undefined) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

const agora = new Date();

if (modo === "registrar") {
  writeJson(heartbeatPath, {
    ultimo_disparo: agora.toISOString(),
    tarefa,
  });
  process.exit(0);
}

// --- modo checar: roda ANTES de qualquer coisa em update-data.ps1, inclusive
// antes do -OnlyIfChanged decidir pular — assim ate um ciclo que so verifica
// e nao coleta nada conta como "a automacao esta viva".
const heartbeatAnterior = readJson(heartbeatPath);
const horasDesdeHeartbeat = heartbeatAnterior?.ultimo_disparo
  ? (agora - new Date(heartbeatAnterior.ultimo_disparo)) / 3_600_000
  : null;

const monitor = readJson(path.join(chunksDir, "monitoramento_coletas.json"));
const ultimoSucesso = monitor?.last_completed_run?.finished_at;
const horasDesdeSucesso = ultimoSucesso
  ? (agora - new Date(ultimoSucesso.replace(" ", "T"))) / 3_600_000
  : null;

const problemas = [];
if (horasDesdeHeartbeat !== null && horasDesdeHeartbeat > LIMITE_HEARTBEAT_HORAS) {
  problemas.push(
    `A automacao nao dispara ha ${horasDesdeHeartbeat.toFixed(1)}h (limite ${LIMITE_HEARTBEAT_HORAS}h). ` +
    "Verificar Task Scheduler, se o PC estava ligado, ou se as tarefas foram desativadas."
  );
}
if (horasDesdeSucesso !== null && horasDesdeSucesso > LIMITE_SUCESSO_HORAS) {
  problemas.push(
    `Nenhuma coleta terminou com SUCESSO ha ${horasDesdeSucesso.toFixed(1)}h (limite ${LIMITE_SUCESSO_HORAS}h). ` +
    "A automacao pode estar disparando mas falhando repetidamente — checar private/logs/."
  );
}

if (problemas.length) {
  const alerta = {
    gerado_em: agora.toISOString(),
    nivel: "critico",
    problemas,
    horas_desde_heartbeat: horasDesdeHeartbeat,
    horas_desde_ultimo_sucesso: horasDesdeSucesso,
  };
  writeJson(alertaPath, alerta);
  console.log("");
  console.log("🚨🚨🚨 ALERTA OPERACIONAL (canal privado, nao publico) 🚨🚨🚨");
  for (const p of problemas) console.log(`  - ${p}`);
  console.log(`  Registrado em: ${alertaPath}`);
  console.log("");
} else if (fs.existsSync(alertaPath)) {
  // Limpa alerta antigo assim que a saude normalizar, para nao confundir
  // quem checar o arquivo mais tarde com um problema ja resolvido.
  fs.rmSync(alertaPath, { force: true });
  console.log("Saude do pipeline normalizada — alerta operacional anterior removido.");
}

writeJson(heartbeatPath, { ultimo_disparo: agora.toISOString(), tarefa });
console.log(
  `Saude do pipeline: heartbeat ${horasDesdeHeartbeat === null ? "(primeiro registro)" : horasDesdeHeartbeat.toFixed(1) + "h atras"}` +
  `, ultimo sucesso ${horasDesdeSucesso === null ? "desconhecido" : horasDesdeSucesso.toFixed(1) + "h atras"}.`
);
