import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { avaliarDetalhamentoDiarias } from "../scripts/lib/audit-diarias.mjs";

const AUDIT = fs.readFileSync(new URL("../scripts/audit-data-quality.mjs", import.meta.url), "utf8");

test("auditoria carrega o chunk de diarias (nao silencia como lista vazia)", () => {
  assert.match(AUDIT, /diarias:\s*readJson\("diarias"\)/);
  assert.match(AUDIT, /chunks\.diarias\.prefeitura/);
  assert.match(AUDIT, /chunks\.diarias\.camara/);
});

test("chunk ausente vira erro de entrada, nao sucesso silencioso", () => {
  assert.match(AUDIT, /diarias-ausente/);
  assert.match(AUDIT, /if\s*\(!chunks\.diarias\)/);
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
