import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { avaliarQuedaAnormal } from "../scripts/lib/data-drop.mjs";

test("queda de mais de 80% e sinalizada", () => {
  const r = avaliarQuedaAnormal(50, 1000);
  assert.ok(r);
  assert.ok(r.percentual > 94 && r.percentual < 96);
  assert.equal(r.zero, false);
});

test("coleta que retorna zero marca zero=true", () => {
  const r = avaliarQuedaAnormal(0, 120);
  assert.ok(r);
  assert.equal(r.zero, true);
  assert.equal(r.percentual, 100);
});

test("variacao normal nao e sinalizada", () => {
  assert.equal(avaliarQuedaAnormal(800, 1000), null);
  assert.equal(avaliarQuedaAnormal(250, 1000), null);
});

test("base pequena nao dispara (evita falso positivo)", () => {
  assert.equal(avaliarQuedaAnormal(0, 9), null);
  assert.equal(avaliarQuedaAnormal(1, 5), null);
});

test("entradas nao finitas nao disparam", () => {
  assert.equal(avaliarQuedaAnormal(NaN, 1000), null);
  assert.equal(avaliarQuedaAnormal(10, undefined), null);
  assert.equal(avaliarQuedaAnormal(10, null), null);
});

test("a auditoria cobre obras, materias, diarias e servidores, nao so contratos", () => {
  const audit = fs.readFileSync(new URL("../scripts/audit-data-quality.mjs", import.meta.url), "utf8");
  for (const id of ["obras-queda-anormal", "materias-queda-anormal", "diarias-prefeitura-queda-anormal", "diarias-camara-queda-anormal", "pessoal-queda-anormal"]) {
    assert.match(audit, new RegExp(id), id);
  }
  const snap = fs.readFileSync(new URL("../scripts/generate-data-snapshots.mjs", import.meta.url), "utf8");
  for (const campo of ["camara_materias_qtd", "diarias_prefeitura_qtd", "diarias_camara_qtd", "pessoal_servidores_qtd"]) {
    assert.match(snap, new RegExp(campo), campo);
  }
});
