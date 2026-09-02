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
const relatoriosHtml = read("painel-cidadao/relatorios.html");
const relatoriosJs = read("painel-cidadao/modules/relatorios.js");
const atualizacoesJs = read("painel-cidadao/modules/atualizacoes.js");
const conformidade = read("painel-cidadao/conformidade.html");
const transparenciaJs = read("painel-cidadao/modules/transparencia.js");
const diariasJs = read("painel-cidadao/modules/diarias.js");
const dataLoader = read("painel-cidadao/data-loader.js");
assert.doesNotMatch(app, /Custo diário elevado/);
assert.match(app, /não representa gasto ou pagamento diário efetivo/);
assert.doesNotMatch(app, />Sem pagamento detectado</);
assert.doesNotMatch(app, /podem configurar irregularidade/);
assert.doesNotMatch(app, /podem indicar fracionamento/);
assert.doesNotMatch(chatFallback, /CNPJ com irregularidade|CNPJ irregular|não necessariamente crime/);
assert.doesNotMatch(chatFallback, /Cada registro mostra beneficiário, destino, finalidade/);
assert.match(chatFallback, /semDestinoFinalidade/);
assert.match(app, /não informado na fonte contratual/);
assert.doesNotMatch(app, /sem contrato formal|sem processo licitatório visível/);
for (const source of [relatoriosHtml, relatoriosJs, atualizacoesJs]) {
  assert.doesNotMatch(source, /R\$ 17\.600|17600|fragmentação suspeita/);
}
assert.doesNotMatch(atualizacoesJs, /sem contrato formal|ausência de contrato formal/);
assert.match(atualizacoesJs, /auditoria-vinculos-suspensa-por-frescor/);
assert.match(atualizacoesJs, /comprasDiretasPref/);
assert.match(relatoriosHtml, /R\$ 65\.492,11/);
assert.match(relatoriosHtml, /R\$ 130\.984,20/);
assert.match(relatoriosHtml, /Decreto 12\.807\/2025/);
assert.match(relatoriosJs, /não prova fracionamento/);
assert.doesNotMatch(relatoriosJs, /Contrato vago|CNPJ oculto|Emenda sem execução|prometidos a/);
assert.match(app, /Proveniência:/);
assert.match(conformidade, /Cobertura pública por assunto e órgão/);
assert.match(conformidade, /Ciclo completo das compras públicas/);
assert.match(conformidade, /Correções, histórico e direito de resposta/);
assert.match(diariasJs, /Campos ausentes não são completados por suposição/);
assert.match(transparenciaJs, /ausência de vínculo não prova ausência de processo/);
assert.match(dataLoader, /"conformidade".*"status_fontes".*"chat_context".*"home_resumo"/);
assert.doesNotMatch(dataLoader, /"conformidade".*"diarias".*"pca"/);

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
