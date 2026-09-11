import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { missingPublicAssets } from "../scripts/lib/public-assets.mjs";

test("servidor libera somente as referências documentais públicas revisadas", () => {
  const htaccess = fs.readFileSync(new URL("../painel-cidadao/.htaccess", import.meta.url), "utf8");
  const pattern = htaccess.match(/^RewriteRule (\^data\/\S+) - \[F,L\]$/m)?.[1];
  assert.ok(pattern);
  const blocked = new RegExp(pattern);
  for (const publicPath of ["data/manifest.json", "data/chunks/resumo.json", "data/referencias/pntp-2025.json", "data/referencias/emendas-municipais-documentos.json"]) {
    assert.equal(blocked.test(publicPath), false, publicPath);
  }
  for (const privatePath of ["data/prefeitura.json", "data/referencias/rascunho.json", "data/referencias/pntp-2025.json.bak"]) {
    assert.equal(blocked.test(privatePath), true, privatePath);
  }
});

test("servidor bloqueia dotfiles em qualquer nivel (ex.: rollback interno)", () => {
  const htaccess = fs.readFileSync(new URL("../painel-cidadao/.htaccess", import.meta.url), "utf8");
  assert.ok(htaccess.includes("(^|/)\\."), "regra de dotfile aninhada ausente");
  // Simula o padrao do Apache: caminho sem barra inicial; casa ./ no inicio ou apos /.
  const bloqueia = (p) => /(^|\/)\./.test(p);
  for (const p of ["emendas/.data.rollback-anterior-x/emendas_tesouro.js", ".env", "emendas/.git/config"]) {
    assert.equal(bloqueia(p), true, p);
  }
  for (const p of ["data/chunks/atualizado_em.json", "data/manifest.json", "emendas/index.html", "style.min.css"]) {
    assert.equal(bloqueia(p), false, p);
  }
});

test("validação detecta dependência dinâmica e fonte omitidas do pacote", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fiscaliza-assets-"));
  try {
    fs.writeFileSync(path.join(dir, "data-loader.js"), 'const modules = ["modules/transparencia.js"];');
    fs.writeFileSync(path.join(dir, "style.css"), '@font-face{src:url("fonts/Inter.woff2")}');
    assert.deepEqual(missingPublicAssets(dir), ["data-loader.js: modules/transparencia.js", "style.css: fonts/Inter.woff2"]);
    fs.mkdirSync(path.join(dir, "modules"));
    fs.mkdirSync(path.join(dir, "fonts"));
    fs.writeFileSync(path.join(dir, "modules/transparencia.js"), "// presente");
    fs.writeFileSync(path.join(dir, "fonts/Inter.woff2"), "presente");
    assert.deepEqual(missingPublicAssets(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
