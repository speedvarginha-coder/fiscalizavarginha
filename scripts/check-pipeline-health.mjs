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
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const chunksDir = path.join(root, "painel-cidadao", "data", "chunks");
const stateDir = path.join(root, "private", "state");
const heartbeatPath = path.join(stateDir, "pipeline_heartbeat.json");
const alertaPath = path.join(stateDir, "alerta_operacional.json");
const lastSuccessPath = path.join(stateDir, "pipeline_last_success.json");
const whatsappConfigPath = path.join(root, "private", "whatsapp_config.json");

// Numero pessoal (nao o grupo publico) para receber ESTE alerta operacional.
// Reusa a mesma bridge Evolution API ja conectada e usada pelo canal publico.
const NUMERO_ALERTA_PESSOAL = "5535991101580";

async function enviarAlertaWhatsapp(texto) {
  const config = readJson(whatsappConfigPath);
  if (!config?.api_url || !config?.token || !config?.instance_id) return false;
  try {
    const resp = await fetch(`${config.api_url}/message/sendText/${config.instance_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.token },
      body: JSON.stringify({
        number: NUMERO_ALERTA_PESSOAL,
        options: { delay: 1200, presence: "composing" },
        textMessage: { text: texto },
      }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// E-mail e o canal de alerta que nao depende da bridge do WhatsApp — se a
// propria bridge cair, o e-mail ainda chega. Delega para um script Python
// (smtplib, stdlib) que le private/email_config.json.
function enviarAlertaEmail(assunto, corpo) {
  const script = path.join(__dirname, "enviar-email-alerta.py");
  if (!fs.existsSync(script)) return false;
  for (const py of ["python", "py", "python3"]) {
    const r = spawnSync(py, [script, assunto, corpo], { encoding: "utf8" });
    if (r.error) continue; // interpretador nao encontrado — tenta o proximo
    if (r.stderr) process.stderr.write(r.stderr);
    return r.status === 0;
  }
  return false;
}

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

const privateSuccess = readJson(lastSuccessPath);
const monitor = readJson(path.join(chunksDir, "monitoramento_coletas.json"));
const ultimoSucesso = privateSuccess?.coleta === "SUCESSO"
  ? privateSuccess.finished_at
  : monitor?.last_completed_run?.coleta === "SUCESSO"
    ? monitor.last_completed_run.finished_at
    : null;
const horasDesdeSucesso = ultimoSucesso
  ? (agora - new Date(String(ultimoSucesso).replace(" ", "T"))) / 3_600_000
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
  // Um alerta que so mora num arquivo local nao ajuda se ninguem for olhar
  // o arquivo — dispara por e-mail (canal privado, separado do grupo publico).
  // E-mail e o canal escolhido por ser resiliente: chega mesmo se a bridge do
  // WhatsApp estiver fora do ar, que e justamente quando o alerta mais importa.
  // (O envio por WhatsApp foi descartado: DM da bridge para numero proprio nao
  // e entregue de forma confiavel — ver enviarAlertaWhatsapp, mantido para uso
  // futuro caso um grupo privado dedicado seja configurado.)
  const texto = `🚨 Fiscaliza Varginha — alerta operacional (tarefa: ${tarefa})\n\n${problemas.join("\n\n")}`;
  const enviadoEmail = enviarAlertaEmail("🚨 Fiscaliza Varginha — alerta operacional", texto);
  console.log(enviadoEmail ? "Alerta enviado por e-mail." : "AVISO: falha ao enviar alerta por e-mail (ver config/senha SMTP).");
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
