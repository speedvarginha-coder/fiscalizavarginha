import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.dirname(fileURLToPath(import.meta.url));
const fonte = fs.readFileSync(path.join(raiz, "..", "painel-cidadao", "chat.php"), "utf8");

const options = fonte.indexOf("if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS')");
const origem = fonte.indexOf("if (!$origemPermitida)");
const metodo = fonte.indexOf("if ($_SERVER['REQUEST_METHOD'] !== 'POST')");
const sessao = fonte.indexOf("$_SESSION['rl_count']++");
const ip = fonte.indexOf("contarUso('ip_'");
const global = fonte.indexOf("contarUso('global_'");

for (const [nome, posicao] of Object.entries({ options, origem, metodo, sessao, ip, global })) {
  assert.ok(posicao >= 0, `nao achei o contrato ${nome} em chat.php`);
}

assert.ok(options < origem, "preflight OPTIONS precisa sair antes da validacao de origem");
assert.ok(origem < metodo, "origem declarada precisa ser recusada antes do metodo");
assert.ok(metodo < sessao, "metodo invalido nao pode consumir limite de sessao");
assert.ok(metodo < ip, "metodo invalido nao pode consumir limite por IP");
assert.ok(metodo < global, "metodo invalido nao pode consumir teto global");

console.log("OK - somente POST autorizado consome a cota do proxy Gemini.");
