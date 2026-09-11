import { test } from "node:test";
import assert from "node:assert/strict";
import { deveRegistrarSucesso } from "../scripts/lib/pipeline-state.mjs";

test("pipeline completo (coleta validada + deploy confirmado + fase final) registra sucesso", () => {
  assert.equal(deveRegistrarSucesso({ coleta: "SUCESSO", fase: "final", deploy: "SUCESSO" }), true);
});

test("fase 'validada' nao registra sucesso antes do deploy (regressao V02)", () => {
  assert.equal(deveRegistrarSucesso({ coleta: "SUCESSO", fase: "validada", deploy: "PENDENTE" }), false);
});

test("deploy falho nao registra sucesso", () => {
  assert.equal(deveRegistrarSucesso({ coleta: "SUCESSO", fase: "final", deploy: "FALHA" }), false);
});

test("coleta falha nao registra sucesso", () => {
  assert.equal(deveRegistrarSucesso({ coleta: "FALHA", fase: "final", deploy: "SUCESSO" }), false);
});

test("payload ausente nao registra", () => {
  assert.equal(deveRegistrarSucesso(undefined), false);
  assert.equal(deveRegistrarSucesso({}), false);
});
