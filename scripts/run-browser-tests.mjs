import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const deploy = args.includes("--deploy");
const port = Number(deploy ? process.env.FISCALIZA_DEPLOY_TEST_PORT || 4184 : process.env.FISCALIZA_TEST_PORT || 4173);
const testRoot = deploy
  ? path.resolve(root, process.env.FISCALIZA_DEPLOY_DIR || "dist", "painel-cidadao")
  : path.resolve(root, process.env.FISCALIZA_TEST_ROOT || "painel-cidadao");

// O processo Python é criado diretamente, sem cmd.exe intermediário. Isso
// permite encerrá-lo pelo PID que criamos, sem taskkill/WMI, que pode travar
// em ambientes Windows restritos mesmo após todos os testes terminarem.
const probe = net.createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(port, "127.0.0.1", () => probe.close(resolve));
});
const env = { ...process.env, FISCALIZA_TEST_ROOT: testRoot, FISCALIZA_TEST_PORT: String(port), FISCALIZA_MANAGED_TEST_SERVER: "1" };
const server = spawn("python", [path.join(root, "scripts/serve-static-tests.py")], { cwd: root, env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let serverError = "";
server.stderr.on("data", data => { serverError = (serverError + data).slice(-2000); });
server.on("error", error => { serverError = error.message; });
const serverClosed = new Promise(resolve => server.once("close", resolve));
let runner;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null || serverError) throw new Error(`Servidor de teste: ${serverError || server.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/index.html`, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      ready = response.ok && response.headers.get("x-fiscaliza-test-process") === String(server.pid);
      if (ready) break;
    } catch { /* aguarda somente o servidor criado nesta execução */ }
    await delay(100);
  }
  if (!ready) throw new Error("O servidor de teste não iniciou com a raiz solicitada.");
  runner = spawn(process.execPath, [path.join(root, "node_modules/@playwright/test/cli.js"), "test",
    ...(deploy ? ["--config", "playwright.deploy.config.js"] : []), ...args.filter(arg => arg !== "--deploy")],
  { cwd: root, env, windowsHide: true, stdio: "inherit" });
  process.exitCode = await new Promise((resolve, reject) => {
    runner.once("error", reject);
    runner.once("exit", code => resolve(code ?? 1));
  });
} finally {
  if (runner && runner.exitCode === null) runner.kill();
  server.kill();
  await Promise.race([serverClosed, delay(2000)]);
}
