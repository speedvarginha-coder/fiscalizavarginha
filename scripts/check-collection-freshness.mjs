#!/usr/bin/env node
/**
 * Vigia da coleta — responde a uma pergunta só: ha quanto tempo o dado nao e
 * atualizado, no repositorio e no site publicado?
 *
 * Por que existe
 * --------------
 * A coleta roda no Agendador de Tarefas do Windows, na maquina do mantenedor, e
 * o alerta de falha sai por SMTP configurado na MESMA maquina. Quando ela para,
 * o alerta para junto: entre 11/08 e 27/08/2026 foram dezesseis dias de silencio
 * com o painel publicando dado velho e ninguem avisado.
 *
 * O monitor externo (uptime-monitor.yml) tambem nao pegava: ele confere se o
 * site responde e se o manifesto bate com o release. Um site congelado ha duas
 * semanas responde 200 e passa nos dois testes.
 *
 * Este script roda em qualquer lugar (CI incluso), nao depende da maquina de
 * coleta e nao precisa de segredo nenhum.
 *
 * Uso:
 *   node scripts/check-collection-freshness.mjs [--limite-horas 36] [--site URL] [--json]
 *
 * Saida: 0 = fresco; 1 = defasado (ou fonte local ilegivel).
 * Um site inacessivel nao reprova sozinho — quem cuida disso e o uptime-monitor.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const chunksDir = path.join(root, "painel-cidadao", "data", "chunks");

const argv = process.argv.slice(2);
const arg = (nome, padrao) => {
  const i = argv.indexOf(nome);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : padrao;
};
const LIMITE_HORAS = Number(arg("--limite-horas", "36"));
const SITE = arg("--site", "https://fiscalizavarginha.com.br");
const COMO_JSON = argv.includes("--json");

const AGORA = Date.now();
const HORA = 3600 * 1000;

function horasDesde(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (AGORA - t) / HORA;
}

function lerJson(arquivo) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

/** "2026-08-11T17:44:31" sem fuso é hora local de quem coletou; tratamos como UTC
 *  para nao inventar frescor de 3h a mais nem a menos que o real. */
function normalizaIso(valor) {
  if (typeof valor !== "string" || !valor.trim()) return null;
  const s = valor.trim();
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`;
}

function idadeLocal() {
  const atualizado = lerJson(path.join(chunksDir, "atualizado_em.json"));
  const monitor = lerJson(path.join(chunksDir, "monitoramento_coletas.json"));
  const carimbos = [
    normalizaIso(atualizado?.iso),
    normalizaIso(monitor?.last_completed_run?.finished_at),
    normalizaIso(monitor?.generated_at),
  ].filter(Boolean);
  if (!carimbos.length) return { horas: null, carimbo: null };
  // O mais recente entre os carimbos: qualquer um deles provando frescor basta.
  const maisRecente = carimbos.reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b));
  return { horas: horasDesde(maisRecente), carimbo: maisRecente };
}

async function idadePublicada() {
  const url = `${SITE.replace(/\/+$/, "")}/data/chunks/atualizado_em.json?vigia=${Date.now()}`;
  try {
    const resposta = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { "cache-control": "no-cache" },
    });
    if (!resposta.ok) return { horas: null, carimbo: null, erro: `HTTP ${resposta.status}` };
    const corpo = JSON.parse((await resposta.text()).replace(/^﻿/, ""));
    const carimbo = normalizaIso(corpo?.iso);
    return { horas: horasDesde(carimbo), carimbo, erro: null };
  } catch (e) {
    return { horas: null, carimbo: null, erro: String(e?.message || e) };
  }
}

const local = idadeLocal();
const publicado = await idadePublicada();

const dias = (h) => (h == null ? null : Number((h / 24).toFixed(1)));
const problemas = [];

if (local.horas == null) {
  problemas.push("Nao foi possivel ler o carimbo de coleta em painel-cidadao/data/chunks/.");
} else if (local.horas > LIMITE_HORAS) {
  problemas.push(
    `Repositorio: ultima coleta ha ${dias(local.horas)} dia(s) (${local.carimbo}), `
    + `acima do limite de ${LIMITE_HORAS}h.`,
  );
}

if (publicado.horas != null && publicado.horas > LIMITE_HORAS) {
  problemas.push(
    `Site publicado: dado de ${publicado.carimbo}, ha ${dias(publicado.horas)} dia(s). `
    + "O site responde normalmente, mas serve dado velho ao cidadao.",
  );
}

const relatorio = {
  verificado_em: new Date(AGORA).toISOString(),
  limite_horas: LIMITE_HORAS,
  repositorio: { carimbo: local.carimbo, horas: local.horas && Number(local.horas.toFixed(1)), dias: dias(local.horas) },
  site: {
    url: SITE,
    carimbo: publicado.carimbo,
    horas: publicado.horas && Number(publicado.horas.toFixed(1)),
    dias: dias(publicado.horas),
    erro: publicado.erro,
  },
  saudavel: problemas.length === 0,
  problemas,
};

if (COMO_JSON) {
  console.log(JSON.stringify(relatorio, null, 2));
} else {
  console.log(`Vigia da coleta — limite ${LIMITE_HORAS}h`);
  console.log(`  repositorio: ${local.carimbo || "ilegivel"} (${dias(local.horas) ?? "?"} dia(s))`);
  console.log(
    publicado.erro
      ? `  site:        inacessivel daqui (${publicado.erro}) — nao conta como falha`
      : `  site:        ${publicado.carimbo || "sem carimbo"} (${dias(publicado.horas) ?? "?"} dia(s))`,
  );
  if (problemas.length) {
    console.log("\nCOLETA DEFASADA:");
    for (const p of problemas) console.log(`  - ${p}`);
  } else {
    console.log("\nOK — coleta dentro da janela esperada.");
  }
}

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `saudavel=${relatorio.saudavel}\n`
    + `dias_repositorio=${relatorio.repositorio.dias ?? "desconhecido"}\n`
    + `dias_site=${relatorio.site.dias ?? "desconhecido"}\n`
    + `resumo<<FIM\n${problemas.join("\n") || "Coleta dentro da janela esperada."}\nFIM\n`,
  );
}

process.exit(relatorio.saudavel ? 0 : 1);
