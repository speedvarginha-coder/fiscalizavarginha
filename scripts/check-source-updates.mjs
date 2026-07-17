#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const painelDir = path.join(root, "painel-cidadao");
const chunksDir = path.join(painelDir, "data", "chunks");
const stateDir = path.join(root, "private", "state");
const statePath = path.join(stateDir, "source-fingerprints.json");
const record = process.argv.includes("--record");
const noExitCode = process.argv.includes("--no-exit-code");

const now = new Date();
const currentYear = now.getFullYear();

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

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function fetchJson(url, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "FiscalizaVarginha/1.0 monitor" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function chunkAgeHours(name) {
  const filePath = path.join(chunksDir, `${name}.json`);
  if (!fs.existsSync(filePath)) return Infinity;
  return (Date.now() - fs.statSync(filePath).mtimeMs) / 3_600_000;
}

function fingerprintDiario(payload) {
  const rows = Array.isArray(payload?.dados) ? payload.dados : [];
  const top = rows.slice(0, 5).map((item) => ({
    edicao: item.edicao || item.Edicao || "",
    data: item.data || item.Data || "",
    extra: item.edicaoExtra || item.EdicaoExtra || "",
  }));
  return { total: rows.length, top };
}

function fingerprintSapl(payload) {
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  const pagination = payload?.pagination || {};
  return {
    count: pagination.count || payload?.count || rows.length,
    next: Boolean(pagination?.links?.next || payload?.next),
    top: rows.slice(0, 5).map((item) => ({
      id: item.id || "",
      ano: item.ano || "",
      numero: item.numero || "",
      data: item.data_apresentacao || item.data_publicacao || "",
      tipo: item.tipo || item.tipo__sigla || item.tipo__descricao || "",
    })),
  };
}

async function probeRemoteSources() {
  const sources = [];

  const saplUrl = `http://sapl.varginha.mg.leg.br/api/materia/materialegislativa/?ano=${currentYear}&page=1`;
  try {
    sources.push({
      id: `sapl-${currentYear}`,
      label: `SAPL Camara ${currentYear}`,
      url: saplUrl,
      fingerprint: fingerprintSapl(await fetchJson(saplUrl)),
    });
  } catch (error) {
    sources.push({ id: `sapl-${currentYear}`, label: `SAPL Camara ${currentYear}`, url: saplUrl, error: error.message });
  }

  const diarioUrl = `https://www.varginha.mg.gov.br/portal/dados-abertos/diario-oficial/${currentYear}`;
  try {
    sources.push({
      id: `diario-${currentYear}`,
      label: `Diario Oficial ${currentYear}`,
      url: diarioUrl,
      fingerprint: fingerprintDiario(await fetchJson(diarioUrl)),
    });
  } catch (error) {
    sources.push({ id: `diario-${currentYear}`, label: `Diario Oficial ${currentYear}`, url: diarioUrl, error: error.message });
  }

  return sources;
}

function localFreshnessSignals() {
  return [
    { id: "prefeitura-betha-age", label: "Prefeitura/Betha", chunk: "prefeitura", maxHours: 24 },
    { id: "camara-betha-age", label: "Camara/Betha", chunk: "camara_betha", maxHours: 12 },
    { id: "diarias-age", label: "Diarias", chunk: "diarias", maxHours: 24 },
    { id: "pncp-age", label: "PNCP", chunk: "pncp", maxHours: 168 },
    { id: "federal-age", label: "Recursos federais", chunk: "federal", maxHours: 168 },
  ].map((item) => {
    const ageHours = chunkAgeHours(item.chunk);
    return {
      ...item,
      ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null,
      stale: ageHours > item.maxHours,
    };
  });
}

const previous = readJson(statePath, { sources: {} });
const remoteSources = await probeRemoteSources();
const localSignals = localFreshnessSignals();
const changes = [];
const errors = [];

for (const source of remoteSources) {
  if (source.error) {
    errors.push(source);
    continue;
  }
  const before = previous.sources?.[source.id]?.fingerprint;
  if (!before || stable(before) !== stable(source.fingerprint)) {
    changes.push({
      id: source.id,
      label: source.label,
      reason: before ? "fingerprint_changed" : "first_seen",
    });
  }
}

for (const signal of localSignals) {
  if (signal.stale) {
    changes.push({
      id: signal.id,
      label: signal.label,
      reason: "local_chunk_stale",
      chunk: signal.chunk,
      ageHours: signal.ageHours,
      maxHours: signal.maxHours,
    });
  }
}

const snapshot = {
  checked_at: now.toISOString(),
  sources: Object.fromEntries(remoteSources.map((source) => [source.id, source])),
  local: Object.fromEntries(localSignals.map((signal) => [signal.id, signal])),
};

if (record) {
  writeJson(statePath, snapshot);
  console.log(`Fingerprints registrados em ${path.relative(root, statePath)}`);
  process.exit(0);
}

const payload = {
  checked_at: now.toISOString(),
  needs_update: changes.length > 0 || errors.length > 0,
  changes,
  errors: errors.map((source) => ({ id: source.id, label: source.label, error: source.error })),
  local: localSignals,
};

// Resultado tambem em arquivo: o node as vezes crasha NO TEARDOWN da saida
// (assertion libuv async.c no Windows) depois do trabalho pronto, corrompendo
// o exit code. O vigia le este arquivo e so usa o exit code como fallback.
writeJson(path.join(stateDir, "probe-result.json"), payload);
console.log(JSON.stringify(payload, null, 2));
process.exit(payload.needs_update && !noExitCode ? 10 : 0);
