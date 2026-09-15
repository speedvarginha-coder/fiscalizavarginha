import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { avaliarDetalhamentoDiarias } from "../scripts/lib/audit-diarias.mjs";
import { internalTimestamp, lastCompleteTimestamp } from "../scripts/lib/source-freshness.mjs";

const AUDIT = fs.readFileSync(new URL("../scripts/audit-data-quality.mjs", import.meta.url), "utf8");

test("auditoria distingue fallback federal da última coleta completa comprovada", () => {
  const code = AUDIT.slice(AUDIT.indexOf("function sourceHealthMetadata("), AUDIT.indexOf("const items = [];"));
  const federal = { _preservado: true, atualizado_em: "2026-09-14T00:00:00Z", status_fontes: { emendas: { status: "ok" } } };
  const run = () => vm.runInNewContext(`${code}; buildSourceStatus()`, {
    domainConfig: [["federal", "Federal", federal, 2]], chunks: {},
    internalTimestamp, lastCompleteTimestamp,
    daysSince: date => date ? (Date.parse("2026-09-14T00:00:00Z") - date.getTime()) / 86400000 : NaN,
  }).domains.federal;
  assert.equal(run().status, "preserved");
  assert.equal(run().source_updated_at, null);
  federal.coleta_frescor = { checked_at: "2026-09-14T00:00:00Z", datasets: {
    emendas: { last_complete_at: "2026-09-01T00:00:00Z" },
    convenios: { last_complete_at: "2026-09-10T00:00:00Z" },
  } };
  assert.equal(run().status, "preserved");
  assert.equal(run().age_days, 13);
  assert.equal(run().checked_at, "2026-09-14T00:00:00.000Z");
  assert.match(run().reason, /última coleta completa comprovada/);
  federal._preservado = false;
  federal.coleta_frescor.datasets.emendas.status = "unknown";
  assert.equal(run().status, "unknown");
});

test("auditoria carrega o chunk de diarias (nao silencia como lista vazia)", () => {
  assert.match(AUDIT, /diarias:\s*readJson\("diarias"\)/);
  assert.match(AUDIT, /chunks\.diarias\.prefeitura/);
  assert.match(AUDIT, /chunks\.diarias\.camara/);
});

test("chunk ausente vira erro de entrada, nao sucesso silencioso", () => {
  assert.match(AUDIT, /diarias-ausente/);
  assert.match(AUDIT, /if\s*\(!chunks\.diarias\)/);
});

test("monitor de atualidade cobre fontes independentes antes omitidas", () => {
  for (const id of ["diarias", "fundacao_cultural", "licitacoes_resultados", "sancoes_fornecedores", "tse_doacoes", "pca"]) {
    assert.match(AUDIT, new RegExp(`\\["${id}"`), id);
  }
});

test("auditoria de modalidade cobre tambem a Fundacao Cultural", () => {
  assert.match(AUDIT, /\["Fundacao Cultural",\s*chunks\.fundacaoCultural\?\.contratos/);
});

test("aponta diarias sem destino e sem finalidade no exercicio", () => {
  const registros = [
    { ano: "2026", destino: "", finalidade: "" },
    { ano: "2026", destino: "Brasilia", finalidade: "" },
  ];
  const r = avaliarDetalhamentoDiarias("Prefeitura", registros, 2026);
  assert.ok(r);
  assert.equal(r.id, "diarias-prefeitura-sem-detalhamento");
  assert.match(r.descricao, /2 registro\(s\): 1 sem destino e 2 sem finalidade/);
});

test("historico conta como finalidade documentada, igual a tela", () => {
  const registros = [{ ano: "2026", destino: "Belo Horizonte", finalidade: "", historico: "Reuniao tecnica" }];
  assert.equal(avaliarDetalhamentoDiarias("Camara", registros, 2026), null);
});

test("base completa nao gera alerta", () => {
  const registros = [{ ano: "2026", destino: "Sao Paulo", finalidade: "Congresso" }];
  assert.equal(avaliarDetalhamentoDiarias("Prefeitura", registros, 2026), null);
});

test("ignora exercicios diferentes e listas vazias", () => {
  const registros = [{ ano: "2025", destino: "", finalidade: "" }];
  assert.equal(avaliarDetalhamentoDiarias("Prefeitura", registros, 2026), null);
  assert.equal(avaliarDetalhamentoDiarias("Prefeitura", [], 2026), null);
  assert.equal(avaliarDetalhamentoDiarias("Prefeitura", undefined, 2026), null);
});
