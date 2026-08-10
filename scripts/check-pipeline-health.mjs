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
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
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
const semEmail = process.argv.includes("--no-email");
const tarefa = (process.argv.find((a) => a.startsWith("--tarefa=")) || "").split("=")[1] || "desconhecida";

// O watchdog roda por FORA do pipeline (node direto, sem passar pelo lock nem
// pela tarefa da coleta). Se ele gravasse o MESMO batimento da coleta, um
// pipeline morto pareceria vivo: foi exatamente isso que mascarou a parada de
// 22/07/2026 — a coleta ficou 3h+ bloqueada e o heartbeat seguia fresco, porque
// o watchdog o renovava a cada 2h. Agora o batimento da COLETA so avanca em
// ciclo de coleta; o watchdog grava o seu, so para telemetria propria.
const ehWatchdog = tarefa.startsWith("watchdog");
const heartbeatWatchdogPath = path.join(stateDir, "watchdog_heartbeat.json");

// Limites: folgados o bastante para nao alarmar por causa de silencio normal
// das fontes (fim de semana, noite), mas curtos o bastante para pegar uma
// automacao real quebrada em menos de um dia.
const LIMITE_HEARTBEAT_HORAS = 6; // nenhum disparo (nem skip) em 6h = Task Scheduler/PC parado
// 14h: com coleta diaria (02:00, 06:30, 07:00) + vigia de hora em hora, passar
// 14h sem NENHUM sucesso ja e anomalia clara. Estava em 48h e por isso a parada
// de 22/07 (pipeline morto desde 09:24) so geraria e-mail no dia seguinte.
const LIMITE_SUCESSO_HORAS = 14;

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

function assinaturaProblemas(lista) {
  const normalizado = lista.map((item) => String(item)
    .replace(/\d+(?:[.,]\d+)?\s*(?:h|min|dias?|d)\b/gi, "#tempo")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?/g, "#data"))
    .sort()
    .join("\n");
  return crypto.createHash("sha256").update(normalizado).digest("hex");
}

const agora = new Date();

if (modo === "registrar") {
  writeJson(ehWatchdog ? heartbeatWatchdogPath : heartbeatPath, {
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
const diariasPrefTentativa = diarias?.meta?.prefeitura?.ultima_tentativa || null;
const diariasPrefStatus = diarias?.meta?.prefeitura?.status || "desconhecido";
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
      `Diarias da Prefeitura sem coleta INTEGRAL bem-sucedida ha ${diasDesdeDiariasPref.toFixed(1)} dias ` +
      `(limite ${LIMITE_DIARIAS_DIAS}). Ultima integral: ${diariasPrefTs}; ultima tentativa: ` +
      `${diariasPrefTentativa || "ausente"}; estado atual: ${diariasPrefStatus}. A busca textual parcial ` +
      "pode manter a base utilizavel, mas nao comprova cobertura completa; os dados anteriores seguem preservados."
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
const whatsappEnvioHabilitado = readJson(whatsappConfigPath)?.envio_habilitado === true;
if (!whatsappEnvioHabilitado) {
  if (fs.existsSync(whatsappFalhaStatePath)) fs.rmSync(whatsappFalhaStatePath, { force: true });
} else if (whatsappStatus === "FALHA") {
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

// (C2b) Vigia dedicado da bridge: detecta porta/processo morto mesmo antes de
// uma coleta tentar enviar mensagens. O vigia de 5 minutos tenta recuperar a
// tarefa; este watchdog transforma falha persistente em alerta operacional.
const bridgeWatchdog = readJson(path.join(stateDir, "whatsapp_bridge_watchdog.json"));
const horasDesdeBridgeCheck = bridgeWatchdog?.checked_at
  ? (agora - new Date(bridgeWatchdog.checked_at)) / 3_600_000
  : null;
if (whatsappEnvioHabilitado && (!bridgeWatchdog || (
  bridgeWatchdog.status !== "ok"
  || horasDesdeBridgeCheck === null
  || horasDesdeBridgeCheck > 1
))) {
  problemas.push(
    `Vigia da ponte WhatsApp em alerta. Estado: ${bridgeWatchdog.status || "desconhecido"}; ` +
    `ultima verificacao: ${bridgeWatchdog.checked_at || "ausente"}. ` +
    "A recuperacao automatica ja foi tentada; verificar QR Code e logs da bridge."
  );
}

// (C3) Ciclo travado: um run pode pendurar segurando o coleta.lock e, com isso,
// fazer TODOS os ciclos seguintes serem pulados. Aconteceu em 22/07/2026: a vigia
// das 09:24 travou (0,4s de CPU em 3h, sem escrever no log) e parou o pipeline por
// 3 horas — nenhum alerta existente pegava, porque os ciclos seguintes morriam no
// Acquire-Lock antes mesmo de rodar este health check (por isso ele agora roda
// ANTES do lock, ver update-data.ps1).
// Sinal preciso = lock antigo E log sem escrita recente. Um ciclo saudavel, mesmo
// demorado (a diaria com auditorias lentas passa de 1h), escreve progresso o tempo
// todo; um travado para de escrever. Isso evita falso positivo em coleta longa.
const LOCK_IDADE_MIN = 45;
const LOG_PARADO_MIN = 30;
const cicloTravadoStatePath = path.join(stateDir, "ciclo_travado_alerta.json");
const lockColetaPath = path.join(root, "private", "logs", "coleta.lock");
let cicloTravadoMin = null;
if (fs.existsSync(lockColetaPath)) {
  // Autocura imediata quando o lock pertence a esta maquina e o PID morreu.
  // Locks de outra maquina ou ilegíveis permanecem para avaliacao conservadora
  // do Acquire-Lock no PowerShell.
  try {
    const [pidText, host] = fs.readFileSync(lockColetaPath, "utf8").trim().split("|");
    const pid = Number(pidText);
    let donoVivo = true;
    if (Number.isInteger(pid) && pid > 0 && (!host || host.toLowerCase() === os.hostname().toLowerCase())) {
      try { process.kill(pid, 0); } catch { donoVivo = false; }
      if (!donoVivo) {
        fs.rmSync(lockColetaPath, { force: true });
        if (fs.existsSync(cicloTravadoStatePath)) fs.rmSync(cicloTravadoStatePath, { force: true });
        console.log(`Auto-heal: coleta.lock orfao removido (PID ${pid} nao existe).`);
      }
    }
  } catch {
    // Falha fechada: um lock de origem desconhecida nunca e removido aqui.
  }
}
if (fs.existsSync(lockColetaPath)) {
  const idadeLockMin = (agora - fs.statSync(lockColetaPath).mtime) / 60_000;
  // Nome do log usa a data LOCAL (Get-Date no PowerShell), nao UTC.
  const hojeLocal = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
  const logHoje = path.join(root, "private", "logs", `coleta-${hojeLocal}.log`);
  const idadeLogMin = fs.existsSync(logHoje)
    ? (agora - fs.statSync(logHoje).mtime) / 60_000
    : Infinity;
  if (idadeLockMin > LOCK_IDADE_MIN && idadeLogMin > LOG_PARADO_MIN) {
    cicloTravadoMin = idadeLockMin;
  }
}
if (cicloTravadoMin !== null) {
  const dedupCiclo = readJson(cicloTravadoStatePath);
  const horasDesdeAlertaCiclo = dedupCiclo?.alertado_em
    ? (agora - new Date(dedupCiclo.alertado_em)) / 3_600_000
    : null;
  if (horasDesdeAlertaCiclo === null || horasDesdeAlertaCiclo >= 6) {
    problemas.push(
      `Um ciclo de coleta parece TRAVADO: segura o lock ha ${cicloTravadoMin.toFixed(0)} min e o log nao ` +
      `recebe escrita ha mais de ${LOG_PARADO_MIN} min. Enquanto isso, todos os ciclos seguintes sao pulados ` +
      "e nada e publicado. Conferir o processo do update-data.ps1 (Gerenciador de Tarefas); se estiver inerte " +
      "(CPU perto de zero), encerrar e apagar private/logs/coleta.lock."
    );
    writeJson(cicloTravadoStatePath, { alertado_em: agora.toISOString(), minutos: cicloTravadoMin });
  } else {
    console.log(
      `Ciclo travado ha ${cicloTravadoMin.toFixed(0)}min — alerta ja enviado ha ` +
      `${horasDesdeAlertaCiclo.toFixed(1)}h; nao reenviando (dedup 6h).`
    );
  }
} else if (fs.existsSync(cicloTravadoStatePath)) {
  fs.rmSync(cicloTravadoStatePath, { force: true });
}

// (C4) Desempenho do site: medição sintética em navegador móvel, sem analytics,
// cookies ou dados de visitantes. Uma tarefa diária atualiza o estado; o watchdog
// alerta se a medição reprovar ou ficar velha, com dedup de 24h.
const performancePath = path.join(stateDir, "site_performance.json");
const performanceAlertPath = path.join(stateDir, "site_performance_alerta.json");
const performanceState = readJson(performancePath);
const horasDesdePerformance = performanceState?.medido_em
  ? (agora - new Date(performanceState.medido_em)) / 3_600_000
  : null;
const performanceProblema = performanceState && (
  performanceState.status !== "ok"
  || horasDesdePerformance === null
  || horasDesdePerformance > 30
);
if (performanceProblema) {
  const dedupPerformance = readJson(performanceAlertPath);
  const horasDesdeAlertaPerformance = dedupPerformance?.alertado_em
    ? (agora - new Date(dedupPerformance.alertado_em)) / 3_600_000
    : null;
  if (horasDesdeAlertaPerformance === null || horasDesdeAlertaPerformance >= 24) {
    const detalhes = Array.isArray(performanceState.falhas)
      ? performanceState.falhas.join("; ")
      : "medição ausente ou inválida";
    problemas.push(
      `Desempenho móvel do site em alerta. Última medição: ${performanceState.medido_em || "desconhecida"}. ` +
      `Detalhes: ${detalhes}. Rodar npm run performance:site e conferir private/state/site_performance.json.`
    );
    writeJson(performanceAlertPath, { alertado_em: agora.toISOString(), status: performanceState.status });
  }
} else if (performanceState?.status === "ok" && fs.existsSync(performanceAlertPath)) {
  fs.rmSync(performanceAlertPath, { force: true });
}

// (C5) Backup local: o rollback so e confiavel se houver snapshot recente e
// completo. As coletas mantem os oito ultimos; aqui verificamos idade e volume.
const backupsRoot = path.join(root, "private", "backups");
let newestBackup = null;
if (fs.existsSync(backupsRoot)) {
  newestBackup = fs.readdirSync(backupsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("coleta-"))
    .map((entry) => {
      const fullPath = path.join(backupsRoot, entry.name);
      return { name: entry.name, fullPath, mtime: fs.statSync(fullPath).mtime };
    })
    .sort((a, b) => b.mtime - a.mtime)[0] || null;
}
const horasDesdeBackup = newestBackup ? (agora - newestBackup.mtime) / 3_600_000 : null;
const backupChunks = newestBackup
  ? path.join(newestBackup.fullPath, "data", "chunks")
  : null;
const quantidadeChunksBackup = backupChunks && fs.existsSync(backupChunks)
  ? fs.readdirSync(backupChunks).filter((name) => name.endsWith(".json")).length
  : 0;
if (!newestBackup || horasDesdeBackup > 48 || quantidadeChunksBackup < 20) {
  problemas.push(
    `Backup local ausente, antigo ou incompleto. Ultimo: ${newestBackup?.name || "nenhum"}; ` +
    `idade: ${horasDesdeBackup === null ? "desconhecida" : horasDesdeBackup.toFixed(1) + "h"}; ` +
    `chunks JSON: ${quantidadeChunksBackup}. Esperado: backup em ate 48h com pelo menos 20 chunks.`
  );
}

// (C6) Copia fora do computador: o Google Drive recebe um ZIP por dia e o
// proprio script confirma o SHA-256 depois da transferencia.
const externalBackup = readJson(path.join(stateDir, "external_backup.json"));
const horasDesdeExternalBackup = externalBackup?.checked_at
  ? (agora - new Date(externalBackup.checked_at)) / 3_600_000
  : null;
if (!externalBackup || externalBackup.status !== "ok" || horasDesdeExternalBackup === null || horasDesdeExternalBackup > 48) {
  problemas.push(
    `Backup externo ausente, falho ou antigo. Estado: ${externalBackup?.status || "ausente"}; ` +
    `ultima verificacao: ${externalBackup?.checked_at || "ausente"}.`
  );
}

// (C7) Monitor externo independente do deploy. Confere pagina, release e hash
// do manifest; uma pagina HTTP 200 com arquivos de versoes diferentes falha.
const externalSite = readJson(path.join(stateDir, "external_site.json"));
const horasDesdeExternalSite = externalSite?.checked_at
  ? (agora - new Date(externalSite.checked_at)) / 3_600_000
  : null;
if (!externalSite || externalSite.status !== "ok" || horasDesdeExternalSite === null || horasDesdeExternalSite > 0.5) {
  problemas.push(
    `Monitor externo do site em alerta. Estado: ${externalSite?.status || "ausente"}; ` +
    `ultima verificacao: ${externalSite?.checked_at || "ausente"}; detalhe: ${externalSite?.detail || "sem detalhe"}.`
  );
}

if (problemas.length) {
  const alertaAnterior = readJson(alertaPath, {});
  const assinatura = assinaturaProblemas(problemas);
  const assinaturaAnterior = alertaAnterior?.assinatura
    || (Array.isArray(alertaAnterior?.problemas) ? assinaturaProblemas(alertaAnterior.problemas) : null);
  const mesmaAssinatura = assinaturaAnterior === assinatura;
  const ultimaNotificacao = mesmaAssinatura
    ? (alertaAnterior.notificado_em || alertaAnterior.gerado_em)
    : null;
  const horasDesdeNotificacao = ultimaNotificacao
    ? (agora - new Date(ultimaNotificacao)) / 3_600_000
    : null;
  const deveNotificar = !mesmaAssinatura || horasDesdeNotificacao === null || horasDesdeNotificacao >= 6;
  const alerta = {
    gerado_em: agora.toISOString(),
    nivel: "critico",
    problemas,
    assinatura,
    notificado_em: mesmaAssinatura ? (alertaAnterior.notificado_em || alertaAnterior.gerado_em || null) : null,
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
  if (semEmail) {
    console.log("Envio de e-mail suprimido por --no-email.");
  } else if (!deveNotificar) {
    console.log(`Alerta equivalente ja notificado ha ${horasDesdeNotificacao.toFixed(1)}h; e-mail suprimido (dedup 6h).`);
  } else {
    const enviadoEmail = enviarAlertaEmail("🚨 Fiscaliza Varginha — alerta operacional", texto);
    if (enviadoEmail) {
      alerta.notificado_em = agora.toISOString();
      writeJson(alertaPath, alerta);
    }
    console.log(enviadoEmail ? "Alerta enviado por e-mail." : "AVISO: falha ao enviar alerta por e-mail (ver config/senha SMTP).");
  }
} else if (fs.existsSync(alertaPath)) {
  // Limpa alerta antigo assim que a saude normalizar, para nao confundir
  // quem checar o arquivo mais tarde com um problema ja resolvido.
  fs.rmSync(alertaPath, { force: true });
  console.log("Saude do pipeline normalizada — alerta operacional anterior removido.");
}

writeJson(ehWatchdog ? heartbeatWatchdogPath : heartbeatPath, {
  ultimo_disparo: agora.toISOString(),
  tarefa,
});
console.log(
  `Saude do pipeline: heartbeat ${horasDesdeHeartbeat === null ? "(primeiro registro)" : horasDesdeHeartbeat.toFixed(1) + "h atras"}` +
  `, ultimo sucesso ${horasDesdeSucesso === null ? "desconhecido" : horasDesdeSucesso.toFixed(1) + "h atras"}.`
);
