/**
 * Garante que cleanText limpa mojibake sem comer acento legitimo.
 *   node tests/test_cleantext_acentos.mjs
 *
 * Regressao real: a regra que removia todo "Â" transformava
 * "CÂMARA · Pessoal" em "CMARA  -  Pessoal" na tela de Sinais prioritários.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "painel-cidadao");
const fonte = readFileSync(join(RAIZ, "modules", "utils.js"), "utf8");

// Extrai só o corpo de cleanText e avalia isolado, sem carregar o módulo inteiro.
const inicio = fonte.indexOf("const cleanText = (v) => {");
if (inicio < 0) {
  console.error("FALHOU: cleanText sumiu de modules/utils.js");
  process.exit(1);
}
let nivel = 0, fim = -1;
for (let i = fonte.indexOf("{", inicio); i < fonte.length; i++) {
  if (fonte[i] === "{") nivel++;
  else if (fonte[i] === "}") { nivel--; if (nivel === 0) { fim = i + 1; break; } }
}
const cleanText = eval(`(${fonte.slice(inicio + "const cleanText = ".length, fim)})`);

let falhas = 0;
const checa = (obtido, esperado, msg) => {
  const ok = obtido === esperado;
  console.log(`  ${ok ? "ok  " : "FALHOU"} ${msg}`);
  if (!ok) {
    console.log(`         esperado: ${JSON.stringify(esperado)}`);
    console.log(`         obtido:   ${JSON.stringify(obtido)}`);
    falhas++;
  }
};

console.log("acento legitimo preservado");
checa(cleanText("CÂMARA · Pessoal"), "CÂMARA · Pessoal", "CÂMARA mantem o circunflexo");
checa(cleanText("Câmara Municipal"), "Câmara Municipal", "Câmara minusculo intacto");
checa(cleanText("Educação"), "Educação", "cedilha e til intactos");
checa(cleanText("PREFEITURA · Contrato"), "PREFEITURA · Contrato", "separador com espaco simples");

console.log("mojibake ainda e limpo");
checa(cleanText("CidadÃ£o"), "Cidadão", "Ã£ vira ã");
checa(cleanText("ContrataÃ§Ã£o"), "Contratação", "Ã§Ã£ vira çã");
checa(cleanText("Valor:Â R$ 10"), "Valor: R$ 10", "Â orfao antes de espaco sai");
checa(cleanText("30Âº andar"), "30º andar", "Â antes de simbolo sai");

console.log("separador");
checa(cleanText("A·B"), "A · B", "separador ganha espaco dos dois lados");
checa(cleanText("A  ·  B"), "A · B", "espaco duplo colapsa");

console.log("");
if (falhas) {
  console.log(`${falhas} verificacao(oes) falharam`);
  process.exit(1);
}
console.log("tudo passou");
