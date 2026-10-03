import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('saúde rejeita PHP indisponível e dados divergentes mesmo com home 200', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fiscaliza-health-'));
  const digest = value => createHash('sha256').update(value).digest('hex');
  const chunk = '{}';
  const chunks = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`extra${i}`, {}]));
  for (const key of ['prefeitura_painel', 'diarias', 'pessoal_resumo']) {
    chunks[key] = { arquivo: `data/chunks/${key}.json`, sha256: digest(chunk) };
  }
  const manifest = JSON.stringify({ chunks });
  let failure = '';
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('Content-Type', 'application/json');
    if (pathname === '/chat.php') {
      res.statusCode = failure === 'php' ? 503 : 405;
      return res.end(JSON.stringify({ erro: 'Método não permitido' }));
    }
    if (pathname === '/avalie.php') return res.end(JSON.stringify({ ok: true }));
    if (pathname === '/release.json') return res.end(JSON.stringify({ manifest_sha256: digest(manifest) }));
    if (pathname === '/data/manifest.json') return res.end(manifest);
    if (pathname === '/data/chunks/atualizado_em.json') return res.end(JSON.stringify({ iso: new Date().toISOString() }));
    if (pathname.startsWith('/data/chunks/')) return res.end(failure === 'chunk' ? '{"alterado":true}' : chunk);
    res.end('<main>Fiscaliza Varginha</main>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (failure of ['', 'php', 'chunk']) {
      const child = spawn(process.execPath, ['scripts/check-external-site.mjs'], {
        env: { ...process.env, FISCALIZA_HEALTH_URL: `http://127.0.0.1:${server.address().port}/`,
          FISCALIZA_HEALTH_STATE_PATH: path.join(dir, 'state.json') }, stdio: 'ignore', windowsHide: true,
      });
      const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
      assert.equal(code, failure ? 1 : 0, failure || 'saudável');
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'))).status, failure ? 'falha' : 'ok');
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
