import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publishFiles } from "../scripts/lib/publish-files.mjs";

for (const failedIndex of [1, 2]) test(`falha no arquivo ${failedIndex + 1} restaura o lote integralmente`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-transaction-"));
  try {
    const paths = ["audit.json", "status.json", "manifest.json"].map(name => path.join(root, name));
    paths.forEach((file, index) => fs.writeFileSync(file, `original-${index}`));
    const io = { ...fs, renameSync(from, to) {
      if (to === paths[failedIndex]) throw Object.assign(new Error("arquivo ocupado"), { code: "UNKNOWN" });
      return fs.renameSync(from, to);
    } };
    assert.throws(() => publishFiles(paths.map(file => [file, "novo"]), { io, attempts: 2, wait() {} }), /arquivo ocupado/);
    paths.forEach((file, index) => assert.equal(fs.readFileSync(file, "utf8"), `original-${index}`));
    assert.equal(fs.readdirSync(root).length, 3);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("bloqueio transitório recupera; arquivo criado em lote rejeitado é removido", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-transaction-"));
  try {
    const fresh = path.join(root, "novo.json"), manifest = path.join(root, "manifest.json");
    fs.writeFileSync(manifest, "anterior");
    let failures = 2;
    const io = { ...fs, renameSync(from, to) {
      if (to === manifest && failures-- > 0) throw Object.assign(new Error("bloqueado"), { code: "EPERM" });
      return fs.renameSync(from, to);
    } };
    assert.throws(() => publishFiles([[fresh, "novo"], [manifest, "atual"]], { io, attempts: 2, wait() {} }));
    assert.equal(fs.existsSync(fresh), false);
    assert.equal(fs.readFileSync(manifest, "utf8"), "anterior");
    failures = 2;
    publishFiles([[fresh, "novo"], [manifest, "atual"]], { io, attempts: 3, wait() {} });
    assert.equal(fs.readFileSync(manifest, "utf8"), "atual");
    assert.equal(fs.readdirSync(root).length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
