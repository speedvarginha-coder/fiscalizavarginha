import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
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

test("publicação automática aceita dados novos, mas bloqueia código alterado", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fiscaliza-baseline-'));
  try {
    for (const part of ['painel-cidadao/data', 'scripts', 'private']) fs.mkdirSync(path.join(dir, part), { recursive: true });
    for (const file of ['package.json', 'package-lock.json', 'private/deploy_completo.py', 'painel-cidadao/app.js']) fs.writeFileSync(path.join(dir, file), '{}');
    fs.copyFileSync(new URL('../scripts/check-code-baseline.mjs', import.meta.url), path.join(dir, 'scripts/check-code-baseline.mjs'));
    const run = (...args) => spawnSync(process.execPath, [path.join(dir, 'scripts/check-code-baseline.mjs'), ...args]).status;
    assert.equal(run(), 1);
    assert.equal(run('--record'), 0);
    fs.writeFileSync(path.join(dir, 'painel-cidadao/data/coleta.json'), 'nova coleta');
    fs.writeFileSync(path.join(dir, 'painel-cidadao/data.js'), 'novo bundle');
    fs.writeFileSync(path.join(dir, 'painel-cidadao/operacao.json'), 'novo estado operacional');
    fs.mkdirSync(path.join(dir, 'painel-cidadao/.data.rollback-anterior'));
    fs.writeFileSync(path.join(dir, 'painel-cidadao/.data.rollback-anterior/backup.json'), 'backup');
    assert.equal(run(), 0);
    fs.writeFileSync(path.join(dir, 'painel-cidadao/app.js'), 'código novo');
    assert.equal(run(), 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
