import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chunksDir = path.join(root, "painel-cidadao", "data", "chunks");
const logsDir = path.join(root, "private", "logs");
const statePath = path.join(root, "private", "state", "pipeline_last_result.json");
const status = JSON.parse(fs.readFileSync(path.join(chunksDir, "status_fontes.json"), "utf8"));

function latestCompletedRun() {
  if (fs.existsSync(statePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (state?.finished_at && state?.coleta) return state;
    } catch {
      // Estado privado corrompido nao derruba a publicacao; usa logs abaixo.
    }
  }
  if (!fs.existsSync(logsDir)) return null;
  const candidates = fs.readdirSync(logsDir)
    .filter((name) => /^coleta-\d{4}-\d{2}-\d{2}\.log$/.test(name))
    .map((name) => {
      const file = path.join(logsDir, name);
      const text = fs.readFileSync(file, "utf8");
      const summaries = [...text.matchAll(/^\[([^\]]+)\]\s+RESUMO:\s+coleta=(\w+)\s+deploy=(\w+)\s+whatsapp=(\w+)/gm)];
      const last = summaries.at(-1);
      return last ? {
        updated_at: fs.statSync(file).mtime.toISOString(),
        finished_at: last[1],
        coleta: last[2], deploy: last[3], whatsapp: last[4],
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.finished_at.replace(" ", "T")) - new Date(a.finished_at.replace(" ", "T")));
  return candidates[0] || null;
}

const sources = Object.entries(status.domains || {}).map(([id, source]) => ({
  id,
  label: source.label || id,
  status: source.status || "unknown",
  source_updated_at: source.source_updated_at || null,
  age_days: source.age_days ?? null,
  max_age_days: source.max_age_days ?? null,
  reason: source.reason || "Sem observação.",
}));
const counts = Object.fromEntries(["ok", "partial", "manual", "preserved", "failed", "unknown"].map((name) => [
  name, sources.filter((source) => source.status === name).length,
]));
const output = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  last_completed_run: latestCompletedRun(),
  summary: { total_sources: sources.length, by_status: counts },
  sources,
};
fs.writeFileSync(path.join(chunksDir, "monitoramento_coletas.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`OK: monitoramento gerado para ${sources.length} fontes`);
