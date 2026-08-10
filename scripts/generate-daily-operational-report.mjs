#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = path.join(root, "private", "state");
const reportsDir = path.join(root, "private", "reports");
const chunksDir = path.join(root, "painel-cidadao", "data", "chunks");
const read = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
};
const state = (name) => read(path.join(stateDir, name));

const pipeline = state("pipeline_last_success.json");
const whatsapp = state("whatsapp_bridge_watchdog.json");
const externalBackup = state("external_backup.json");
const externalSite = state("external_site.json");
const monitor = read(path.join(chunksDir, "monitoramento_coletas.json"), {});
const audit = read(path.join(chunksDir, "auditoria_dados.json"), {});
const sourceSummary = monitor.summary?.by_status || {};
const auditSummary = audit.summary || {};
const now = new Date();
const date = now.toISOString().slice(0, 10);

const report = {
  schema: 1,
  generated_at: now.toISOString(),
  overall: "ok",
  pipeline: pipeline || { status: "ausente" },
  whatsapp: whatsapp || { status: "ausente" },
  external_backup: externalBackup || { status: "ausente" },
  external_site: externalSite || { status: "ausente" },
  sources: sourceSummary,
  data_audit: auditSummary,
};

const problems = [];
if (pipeline?.coleta !== "SUCESSO" || pipeline?.deploy !== "SUCESSO") problems.push("ultima coleta/publicacao bem-sucedida nao confirmada");
if (whatsapp?.status !== "ok") problems.push("ponte WhatsApp sem confirmacao");
if (externalBackup?.status !== "ok") problems.push("backup externo sem confirmacao");
if (externalSite?.status !== "ok") problems.push("site externo sem confirmacao");
if (Number(sourceSummary.failed || 0) > 0 || Number(sourceSummary.stale || 0) > 0) problems.push("fonte falha ou desatualizada");
report.overall = problems.length ? "atencao" : "ok";
report.problems = problems;

const lines = [
  `Fiscaliza Varginha - relatorio operacional ${date}`,
  "",
  `Estado geral: ${report.overall.toUpperCase()}`,
  `Ultimo sucesso: coleta=${pipeline?.coleta || "ausente"}, deploy=${pipeline?.deploy || "ausente"}, WhatsApp=${pipeline?.whatsapp || "ausente"}`,
  `Ponte WhatsApp: ${whatsapp?.status || "ausente"} (${whatsapp?.checked_at || "sem horario"})`,
  `Site externo: ${externalSite?.status || "ausente"} (${externalSite?.checked_at || "sem horario"})`,
  `Backup externo: ${externalBackup?.status || "ausente"} - ${externalBackup?.file || "sem arquivo"}`,
  `Fontes: ok=${sourceSummary.ok || 0}, parciais=${sourceSummary.partial || 0}, preservadas=${sourceSummary.preserved || 0}, falhas=${sourceSummary.failed || 0}, antigas=${sourceSummary.stale || 0}`,
  `Auditoria de dados: erros=${auditSummary.errors || 0}, avisos=${auditSummary.warnings || 0}, itens=${auditSummary.total || 0}`,
  problems.length ? `Pendencias operacionais: ${problems.join("; ")}` : "Pendencias operacionais: nenhuma.",
  "",
  "Observacao: alertas editoriais e dados parciais sao tratados como contexto de verificacao, nao como acusacao.",
].join("\n");

fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(path.join(reportsDir, `operacional-${date}.json`), JSON.stringify(report, null, 2) + "\n", "utf8");
fs.writeFileSync(path.join(reportsDir, `operacional-${date}.txt`), lines + "\n", "utf8");
fs.writeFileSync(path.join(stateDir, "daily_operational_report.json"), JSON.stringify({
  generated_at: now.toISOString(),
  status: report.overall,
  report: `operacional-${date}.json`,
}, null, 2) + "\n", "utf8");

if (process.argv.includes("--email")) {
  const emailScript = path.join(root, "scripts", "enviar-email-alerta.py");
  const result = spawnSync("python", [emailScript, `Fiscaliza Varginha - relatorio diario ${date}`, lines], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "Falha ao enviar relatorio por e-mail.\n");
    process.exit(1);
  }
}

console.log(lines);
