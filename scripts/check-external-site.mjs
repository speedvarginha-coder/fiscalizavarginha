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

try {
  const [home, releaseText, manifestBytes] = await Promise.all([
    get(""),
    get("release.json"),
    get("data/manifest.json", "bytes"),
  ]);
  if (!/Fiscaliza\s+Varginha/i.test(home)) throw new Error("A pagina inicial nao contem a identidade do projeto.");
  const release = JSON.parse(releaseText);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const digest = crypto.createHash("sha256").update(manifestBytes).digest("hex");
  if (release.manifest_sha256 !== digest) throw new Error("release.json diverge do manifest publicado.");
  const chunkCount = Object.keys(manifest.chunks || {}).length;
  if (chunkCount < 20) throw new Error(`Manifest publicado tem somente ${chunkCount} chunks.`);
  write("ok", "Site, release e manifest conferidos.", { manifest_sha256: digest, chunks: chunkCount });
  console.log(`OK - site externo saudavel (${chunkCount} chunks).`);
} catch (error) {
  write("falha", String(error?.message || error));
  console.error(`FALHA - site externo: ${error?.message || error}`);
  process.exit(1);
}
