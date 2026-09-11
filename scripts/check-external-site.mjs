#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statePath = path.join(root, "private", "state", "external_site.json");
const base = (process.env.FISCALIZA_HEALTH_URL || "https://fiscalizavarginha.com.br/").replace(/\/?$/, "/");

async function get(relative, type = "text") {
  const url = new URL(relative, base);
  url.searchParams.set("health_check", Date.now().toString());
  const response = await fetch(url, {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${relative}: HTTP ${response.status}`);
  return type === "bytes" ? Buffer.from(await response.arrayBuffer()) : response.text();
}

function write(status, detail, extra = {}) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({
    schema: 1,
    checked_at: new Date().toISOString(),
    status,
    detail,
    url: base,
    ...extra,
  }, null, 2) + "\n", "utf8");
}

// O carimbo da coleta principal e hora local sem fuso; tratar como -03:00 evita
// que o relogio do verificador (UTC no GitHub) invente tres horas de atraso.
function idadeDaColetaHoras(iso) {
  if (!iso) return NaN;
  const texto = String(iso);
  const comFuso = /[zZ]|[+-]\d\d:?\d\d$/.test(texto) ? texto : `${texto}-03:00`;
  const momento = new Date(comFuso);
  if (Number.isNaN(momento.getTime())) return NaN;
  return (Date.now() - momento.getTime()) / 3_600_000;
}

try {
  const [home, releaseText, manifestBytes, atualizadoText] = await Promise.all([
    get(""),
    get("release.json"),
    get("data/manifest.json", "bytes"),
    get("data/chunks/atualizado_em.json"),
  ]);
  if (!/Fiscaliza\s+Varginha/i.test(home)) throw new Error("A pagina inicial nao contem a identidade do projeto.");
  const release = JSON.parse(releaseText);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const atualizado = JSON.parse(atualizadoText);
  const digest = crypto.createHash("sha256").update(manifestBytes).digest("hex");
  if (release.manifest_sha256 !== digest) throw new Error("release.json diverge do manifest publicado.");
  const chunkCount = Object.keys(manifest.chunks || {}).length;
  if (chunkCount < 20) throw new Error(`Manifest publicado tem somente ${chunkCount} chunks.`);

  // Disponibilidade (HTTP 200 + integridade) nao e o mesmo que atualidade. Um
  // site estatico coerente pode ficar dias sem coleta nova; medir a idade do
  // carimbo e o que detecta a maquina coletora parada.
  const idadeHoras = idadeDaColetaHoras(atualizado?.iso);
  const limiteHoras = Number(process.env.FISCALIZA_MAX_DATA_AGE_HOURS || 30);
  const extra = {
    manifest_sha256: digest,
    chunks: chunkCount,
    collection_age_hours: Number.isFinite(idadeHoras) ? Number(idadeHoras.toFixed(1)) : null,
    max_data_age_hours: Number.isFinite(limiteHoras) ? limiteHoras : null,
  };
  if (!Number.isFinite(idadeHoras)) {
    throw new Error("atualizado_em.json sem carimbo de coleta valido.");
  }
  if (idadeHoras > limiteHoras) {
    write("defasado", `Site no ar, mas a ultima coleta tem ${idadeHoras.toFixed(1)} h (limite ${limiteHoras} h).`, extra);
    console.error(`FALHA - coleta parada: ${idadeHoras.toFixed(1)} h sem atualizacao (limite ${limiteHoras} h).`);
    process.exitCode = 1;
  } else {
    write("ok", "Site, release, manifest e idade da coleta conferidos.", extra);
    console.log(`OK - site externo saudavel (${chunkCount} chunks; coleta ha ${idadeHoras.toFixed(1)} h).`);
  }
} catch (error) {
  write("falha", String(error?.message || error));
  console.error(`FALHA - site externo: ${error?.message || error}`);
  process.exitCode = 1;
}
