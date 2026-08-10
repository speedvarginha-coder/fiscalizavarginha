import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));

const index = read("painel-cidadao/index.html");
assert.match(index, /<b>29%<\/b> Secretaria de Saúde/);
assert.match(index, /<b>30%<\/b> Outras áreas/);
assert.doesNotMatch(index, /<b>39%<\/b> Saúde/);
assert.match(index, /autoavaliação do Programa Nacional/);
assert.match(index, /não constam como validados ou revisados/);

const chatPhp = read("painel-cidadao/chat.php");
const chatFallback = read("painel-cidadao/modules/chat-cidadao.js");
const pessoal = read("painel-cidadao/pessoal.html");
for (const source of [chatPhp, chatFallback]) {
  assert.doesNotMatch(source, /20 dias úteis/);
  assert.match(source, /20 dias corridos/);
}
assert.doesNotMatch(chatFallback, /17 vereadores/);
assert.doesNotMatch(chatFallback, /Em 2026 foram registradas/);
assert.match(chatFallback, /Na base de/);
assert.doesNotMatch(pessoal, /17 vereadores eleitos/);
assert.match(chatPhp, /chat_context\.json/);
assert.match(chatPhp, /Use exclusivamente o JSON abaixo/);

const app = read("painel-cidadao/app.js");
assert.doesNotMatch(app, /Custo diário elevado/);
assert.match(app, /não representa gasto ou pagamento diário efetivo/);
assert.doesNotMatch(app, />Sem pagamento detectado</);

const contexto = json("painel-cidadao/data/chunks/chat_context.json");
const prefeitura = json("painel-cidadao/data/chunks/prefeitura.json");
const camara = json("painel-cidadao/data/chunks/camara_betha.json");
const diarias = json("painel-cidadao/data/chunks/diarias.json");

assert.equal(contexto.prefeitura.total_pago_fornecedores_externos, prefeitura.total_externo_atual);
assert.equal(contexto.prefeitura.obras_publicas, prefeitura.obras_publicas.length);
assert.equal(contexto.camara.total_pago_fornecedores_externos, camara.total_externo_atual);
assert.equal(contexto.camara.contratos_total, camara.contratos.length);
assert.deepEqual(contexto.diarias.prefeitura, diarias.resumo.prefeitura);
assert.deepEqual(contexto.diarias.camara, diarias.resumo.camara);
assert.equal(contexto.camara.cadeiras, 15);
assert.equal(contexto.fundeb_2026.valor, 104_771_249.39);
assert.equal(contexto.fundeb_2026.tipo, "previsao_oficial_de_receita");
assert.equal(contexto.pntp_2025.validada, false);

const duplicadas = prefeitura.obras_publicas.filter(
  (obra) =>
    String(obra.contrato_numero) === "16" &&
    String(obra.contrato_ano) === "2024" &&
    /Otávio Marques de Paiva/i.test(obra.endereco || ""),
);
assert.equal(duplicadas.length, 1);
assert.equal(duplicadas[0].id_obra, "82");

console.log("OK — afirmações editoriais e resumo do chatbot estão consistentes.");
