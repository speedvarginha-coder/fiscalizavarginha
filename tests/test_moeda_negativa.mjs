/**
 * Formatacao de dinheiro do painel.
 *   node tests/test_moeda_negativa.mjs
 *
 * Regressao real (10/09/2026): o resumo de Atualizacoes publicou
 * "R$ -2.395.653,21" para a revisao de valor dos contratos. Em portugues o
 * sinal vem antes do simbolo da moeda: -R$ 2.395.653,21.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "painel-cidadao");
const fonte = readFileSync(join(RAIZ, "modules", "utils.js"), "utf8");
const window = {};
new Function("window", fonte)(window);
const { fmtBRL, fmtMi, fmtNum } = window.FISCALIZA.utils;

let falhas = 0;
const checa = (obtido, esperado, motivo) => {
  if (obtido === esperado) return;
  falhas++;
  console.error(`FALHOU: ${motivo} -> "${obtido}", esperado "${esperado}"`);
};

checa(fmtBRL(0), "R$ 0,00", "zero");
checa(fmtBRL(null), "R$ 0,00", "nulo vira zero");
checa(fmtBRL(1234.5), "R$ 1.234,50", "positivo com centavos");
checa(fmtBRL(-2395653.21), "-R$ 2.395.653,21", "negativo com o sinal antes do simbolo");
checa(fmtBRL(-0.01), "-R$ 0,01", "centavo negativo");
checa(fmtMi(3528268), "R$ 3,5 mi", "milhoes positivos");
checa(fmtMi(-5400000), "-R$ 5,4 mi", "milhoes negativos");
checa(fmtNum(6053), "6.053", "milhar com separador");

if (falhas) {
  console.error(`
${falhas} falha(s) na formatacao de dinheiro.`);
  process.exit(1);
}
console.log("OK: dinheiro formatado com o sinal antes do simbolo.");
