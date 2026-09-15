import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { prefeituraPainel } from "../scripts/lib/dados-painel.mjs";
import { internalTimestamp, lastCompleteTimestamp } from "../scripts/lib/source-freshness.mjs";

test("base leve preserva todos os contratos, cruzamentos e campos futuros", () => {
  const original = { contratos: [{ numero: "001", valor: 12 }], emendas_cruzadas: [{ valor_pago_total: 6 }], novo_campo: { registros: [1, 2] }, frota: [{ placa: "ABC" }] };
  const result = prefeituraPainel(original);
  assert.deepEqual(result, { contratos: original.contratos, emendas_cruzadas: original.emendas_cruzadas, novo_campo: original.novo_campo });
  assert.equal(original.frota.length, 1);
});

test("arquivo leve publicado corresponde à base canônica fora dos detalhes da frota", () => {
  const read = name => JSON.parse(fs.readFileSync(new URL(`../painel-cidadao/data/chunks/${name}.json`, import.meta.url), "utf8"));
  const original = read("prefeitura");
  const slim = read("prefeitura_painel");
  assert.ok(original.contratos.length > 0);
  for (const key of Object.keys(original).filter(key => key !== "frota")) assert.deepEqual(slim[key], original[key], key);
  assert.equal(Object.hasOwn(slim, "frota"), false);
});

test("painel enxuto + chunk de frota reconstroem a base da Prefeitura sem perda", () => {
  const read = name => JSON.parse(fs.readFileSync(new URL(`../painel-cidadao/data/chunks/${name}.json`, import.meta.url), "utf8"));
  const original = read("prefeitura");
  const slim = read("prefeitura_painel");
  const frota = read("prefeitura_frota");
  assert.ok(Array.isArray(original.frota) && original.frota.length > 0);
  assert.equal(frota.frota.length, original.frota.length);
  assert.deepEqual({ ...slim, frota: frota.frota }, original);
});

test("sancoes_fornecedores so e carregado onde e usado (Como cobrar)", () => {
  const loader = fs.readFileSync(new URL("../painel-cidadao/data-loader.js", import.meta.url), "utf8");
  const cfg = loader.match(/const CHUNKS_POR_PAGINA = (\{[\s\S]*?\});/)[1];
  assert.match(cfg, /"cobrar":\s*\[[^\]]*"sancoes_fornecedores"/);
  for (const page of ["home", "prefeitura", "camara", "relatorios", "fundacao", "atualizacoes", "marcadores"]) {
    const lista = cfg.match(new RegExp(`"${page}":\\s*\\[([^\\]]*)\\]`))[1];
    assert.doesNotMatch(lista, /sancoes_fornecedores/, page);
  }
});

test("fallback offline contém a mesma versão de cada chunk público", () => {
  const panel = new URL("../painel-cidadao/", import.meta.url);
  const text = fs.readFileSync(new URL("data.js", panel), "utf8");
  const bundle = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const chunks = new URL("data/chunks/", panel);
  for (const name of fs.readdirSync(chunks).filter(name => name.endsWith(".json"))) {
    const canonical = JSON.parse(fs.readFileSync(new URL(name, chunks), "utf8"));
    assert.deepEqual(bundle[name.slice(0, -5)], canonical, name);
  }
});

test("data de negócio não rejuvenesce fonte sem carimbo de coleta", () => {
  assert.equal(internalTimestamp({ contratos: [{ atualizado_em: "2099-01-01T00:00:00Z" }] }), undefined);
  const result = internalTimestamp({ metadata: { coletado_em: "2026-08-01T00:00:00Z" }, contratos: [{ atualizado_em: "2099-01-01T00:00:00Z" }] });
  assert.equal(result.toISOString(), "2026-08-01T00:00:00.000Z");
});

test("metadados anuais usam a coleta mais recente independentemente da ordem", () => {
  assert.equal(internalTimestamp({ 2025: { coletado_em: "2026-08-01" }, 2026: { coletado_em: "2026-09-01" } }).toISOString(), "2026-09-01T00:00:00.000Z");
});

test("fonte preservada mantém a idade do conjunto completo mais antigo", () => {
  const payload = { atualizado_em: "2026-09-14", coleta_frescor: { datasets: {
    contratos: { last_complete_at: "2026-09-01T00:00:00Z" },
    frota: { last_complete_at: "2026-09-10T00:00:00Z" },
  } } };
  assert.equal(lastCompleteTimestamp(payload).toISOString(), "2026-09-01T00:00:00.000Z");
  payload.coleta_frescor.datasets.frota.last_complete_at = null;
  assert.equal(lastCompleteTimestamp(payload), undefined);
  payload.coleta_frescor.datasets.frota.last_complete_at = "invalida";
  assert.equal(lastCompleteTimestamp(payload), undefined);
  assert.equal(lastCompleteTimestamp({ atualizado_em: "2026-09-14" }), undefined);
});

test("checkout novo reconstrói fallback e incorpora atualizações de chunks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fiscaliza-bundle-"));
  try {
    fs.mkdirSync(path.join(root, "scripts/lib"), { recursive: true });
    fs.mkdirSync(path.join(root, "painel-cidadao/data/chunks"), { recursive: true });
    for (const file of ["sync-data-bundle.mjs", "lib/dados-painel.mjs"]) {
      fs.copyFileSync(new URL(`../scripts/${file}`, import.meta.url), path.join(root, "scripts", file));
    }
    const chunk = path.join(root, "painel-cidadao/data/chunks/pncp.json");
    const script = path.join(root, "scripts/sync-data-bundle.mjs");
    for (const value of [10, 25]) {
      fs.writeFileSync(chunk, JSON.stringify({ contratos: [{ valor: value }] }));
      execFileSync(process.execPath, [script], { stdio: "pipe" });
      const text = fs.readFileSync(path.join(root, "painel-cidadao/data.js"), "utf8");
      const bundle = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      assert.equal(bundle.pncp.contratos[0].valor, value);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
