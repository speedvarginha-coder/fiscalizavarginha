import { test } from "node:test";
import assert from "node:assert/strict";
import { avaliarCicloInterrompido } from "../scripts/lib/pipeline-progress.mjs";

const AGORA = Date.parse("2026-09-11T12:00:00Z");

test("ciclo iniciado ha mais que o limite e morte por limite de tempo", () => {
  const r = avaliarCicloInterrompido(
    { iniciado_em: "2026-09-11T05:30:00Z", fase: "coleta", pid: 123, tarefa: "diaria" },
    AGORA,
    5,
  );
  assert.ok(r);
  assert.ok(r.horas > 6 && r.horas < 7);
  assert.equal(r.fase, "coleta");
  assert.equal(r.pid, 123);
  assert.equal(r.tarefa, "diaria");
});

test("ciclo dentro do orcamento nao alerta", () => {
  assert.equal(
    avaliarCicloInterrompido({ iniciado_em: "2026-09-11T11:00:00Z", fase: "coleta" }, AGORA, 5),
    null,
  );
});

test("sem marcador nao alerta", () => {
  assert.equal(avaliarCicloInterrompido(null, AGORA, 5), null);
  assert.equal(avaliarCicloInterrompido({}, AGORA, 5), null);
});

test("data invalida no marcador nao alerta (nao inventa morte)", () => {
  assert.equal(avaliarCicloInterrompido({ iniciado_em: "ontem" }, AGORA, 5), null);
});
