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

// (C) Defasagem por fonte: as diarias da Prefeitura (consulta Betha 83059) podem
// parar de coletar (ex.: HTTP 406 no export CSV do lado da Betha) enquanto o resto
// do pipeline segue saudavel — antes isso rotava em silencio. O carimbo
// meta.prefeitura.atualizado_em (gravado por coletor.py) so avanca quando a fonte
// e coletada com sucesso. Dedup: no maximo um e-mail a cada 24h para esta condicao,
// para nao spammar na vigia horaria enquanto a Betha nao normaliza.
const LIMITE_DIARIAS_DIAS = 4;
const diariasStaleStatePath = path.join(stateDir, "diarias_stale_alerta.json");
const diarias = readJson(path.join(chunksDir, "diarias.json"));
const diariasPrefTs = diarias?.meta?.prefeitura?.atualizado_em || null;
const diasDesdeDiariasPref = diariasPrefTs
  ? (agora - new Date(diariasPrefTs)) / 86_400_000
  : null;
if (diasDesdeDiariasPref !== null && diasDesdeDiariasPref > LIMITE_DIARIAS_DIAS) {
  const dedup = readJson(diariasStaleStatePath);
  const horasDesdeAlerta = dedup?.alertado_em
    ? (agora - new Date(dedup.alertado_em)) / 3_600_000
    : null;
  if (horasDesdeAlerta === null || horasDesdeAlerta >= 24) {
    problemas.push(
      `Diarias da Prefeitura sem coleta bem-sucedida ha ${diasDesdeDiariasPref.toFixed(1)} dias ` +
      `(limite ${LIMITE_DIARIAS_DIAS}). Ultima OK: ${diariasPrefTs}. A consulta Betha 83059 pode estar ` +
      "recusando o export (HTTP 406) — os dados antigos seguem preservados, mas sem atualizar. Checar private/logs/."
    );
    writeJson(diariasStaleStatePath, { alertado_em: agora.toISOString(), dias: diasDesdeDiariasPref });
  } else {
    console.log(
      `Diarias da Prefeitura defasadas (${diasDesdeDiariasPref.toFixed(1)}d) — alerta ja enviado ha ` +
      `${horasDesdeAlerta.toFixed(1)}h; nao reenviando (dedup 24h).`
    );
  }
} else if (fs.existsSync(diariasStaleStatePath)) {
  fs.rmSync(diariasStaleStatePath, { force: true });
}

// (C2) Falha do WhatsApp: a sessao do bridge pode cair (aconteceu em 20 e 21/07) e
// exigir novo pareamento por QR Code. Nesse estado o bot faz a coisa certa — detecta
// no healthcheck, NAO envia e preserva a fila — mas o resto do pipeline segue
// "saudavel" e ninguem era avisado, entao o grupo ficava mudo em silencio.
// Alerta assim que um ciclo reporta whatsapp=FALHA, com dedup de 24h (a condicao
// persiste ate alguem reparear). PULADO nao alerta aqui: significa que a coleta
// falhou antes, e isso ja e coberto pelos alertas de coleta acima.
const whatsappFalhaStatePath = path.join(stateDir, "whatsapp_falha_alerta.json");
const ultimoResultado = readJson(path.join(stateDir, "pipeline_last_result.json"));
const whatsappStatus = ultimoResultado?.whatsapp || null;
if (whatsappStatus === "FALHA") {
  const dedupWa = readJson(whatsappFalhaStatePath);
  const horasDesdeAlertaWa = dedupWa?.alertado_em
    ? (agora - new Date(dedupWa.alertado_em)) / 3_600_000
    : null;
  if (horasDesdeAlertaWa === null || horasDesdeAlertaWa >= 24) {
    problemas.push(
      "Alertas do WhatsApp falharam no ultimo ciclo (whatsapp=FALHA). Causa tipica: a sessao do " +
      "bridge caiu e precisa ser pareada de novo pelo QR Code em " +
      "https://whatsapp.fiscalizavarginha.com.br — a fila de mensagens fica preservada ate reconectar."
    );
    writeJson(whatsappFalhaStatePath, { alertado_em: agora.toISOString(), status: whatsappStatus });
  } else {
    console.log(
      `WhatsApp em FALHA — alerta ja enviado ha ${horasDesdeAlertaWa.toFixed(1)}h; ` +
      "nao reenviando (dedup 24h)."
    );
  }
} else if (fs.existsSync(whatsappFalhaStatePath)) {
  fs.rmSync(whatsappFalhaStatePath, { force: true });
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
