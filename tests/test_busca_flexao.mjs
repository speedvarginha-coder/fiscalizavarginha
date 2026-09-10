/**
 * Garante que a busca do painel acha o que o cidadao realmente digita.
 *   node tests/test_busca_flexao.mjs
 *
 * Regressao real (auditoria de 10/09/2026, site em producao):
 *   "hospital" achava 105 emendas e "hospitais" achava 0;
 *   "professor" achava 544 servidores e "professora" achava 0;
 *   "escola" achava 31 contratos e "escolas" achava 8.
 * O placeholder do portal de emendas sugeria "hospital, esporte, escola" —
 * e o plural dos proprios exemplos devolvia zero.
 *
 * Este teste tranca o motor compartilhado (casaBusca) contra tres regressoes:
 *   1. plural/feminino precisa casar com o singular masculino da base
 *   2. numero de contrato e sigla nao podem quebrar com o radical
 *   3. termo que nao existe continua devolvendo zero (o filtro filtra)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "painel-cidadao");
const fonte = readFileSync(join(RAIZ, "modules", "utils.js"), "utf8");

// utils.js nao toca DOM no topo — basta um window de mentira para avaliar o IIFE.
const window = {};
new Function("window", fonte)(window);
const { norm, casaBusca, radical } = window.FISCALIZA.utils;

if (typeof casaBusca !== "function") {
  console.error("FALHOU: casaBusca sumiu de modules/utils.js");
  process.exit(1);
}

let falhas = 0;
const checa = (texto, consulta, esperado, motivo) => {
  const obtido = casaBusca(texto, norm(consulta));
  if (obtido === esperado) return;
  falhas++;
  console.error(
    `FALHOU: "${consulta}" em "${texto}" -> ${obtido}, esperado ${esperado}` +
    (motivo ? ` (${motivo})` : "")
  );
};

// 1. Plural e feminino — o caso que motivou a correcao.
checa("ESCOLA MUNICIPAL JOAO XXIII", "escolas", true, "plural simples");
checa("ESCOLA MUNICIPAL JOAO XXIII", "escola", true, "singular");
checa("HOSPITAL BOM PASTOR", "hospitais", true, "plural em -ais");
checa("PROFESSOR DE EDUCACAO BASICA", "professora", true, "feminino");
checa("ASSOCIACAO DE MORADORES", "associacoes", true, "plural em -coes");
checa("PAPEL SULFITE A4", "papeis", true, "plural em -eis");
checa("AQUISICAO DE BENS PERMANENTES", "bem", true, "singular em -m");

// 2. Acento, caixa e trecho literal continuam funcionando.
checa("SECRETARIA DE SAUDE", "saúde", true, "acento na consulta");
checa("SECRETARIA DE SAÚDE", "saude", true, "acento no dado");
checa("CLX PRODUCOES LTDA", "clx", true, "sigla curta");
checa("CONTRATO 0/2020 LUIZ FORTE", "0/2020", true, "numero de contrato");
checa("CONTRATO 15/2020 OUTRA EMPRESA", "0/2020", false, "numero de contrato nao pode virar 'qualquer coisa de 2020'");
checa("OFICINA DO NENE LTDA", "oficina do nene", true, "frase inteira");
checa("OFICINA DO NENE LTDA", "nene oficina", true, "termos fora de ordem");

// 3. Erro de digitacao de uma letra so, a partir de 7 caracteres.
checa("SERVICO DE LIMPEZA URBANA", "limpesa", true, "troca de letra");
checa("PAVIMENTACAO ASFALTICA", "pavimentaao", true, "letra faltando");

// 4. O filtro ainda filtra — sem isto a busca vira enfeite.
checa("MERENDA ESCOLAR", "hospital", false, "termo ausente");
checa("MERENDA ESCOLAR", "zzzzzz", false, "termo inexistente");
checa("MERENDA ESCOLAR", "meranda escolar hospital", false, "um termo ausente reprova tudo");
checa("CLX PRODUCOES LTDA", "abc", false, "sigla errada de 3 letras nao pode virar erro de digitacao");
checa("CONTRATO C 12 DE APOIO", "clx", false, "sigla nao pode casar a palavra solta 'c' por prefixo");
checa("AUX. DE DENTISTA - MEDIA/ALTA COMPLEXIDADE", "medico", false, "cargo 'medico' nao pode casar a lotacao 'MEDIA'");
checa("MEDICO PLANTONISTA", "medico", true, "cargo de medico continua achando");
checa("REQUERIMENTO DE SOLICITACAO DE ACESSO", "licitacao", false, "termo nao pode casar no meio de outra palavra (solicitacao)");
checa("PROCESSO DE LICITACAO PUBLICA", "licitacao", true, "a palavra de verdade continua achando");
checa("AUX. DE DENTISTA - MEDIA/ALTA COMPLEXIDADE", "medica", false, "palavra curta nao entra na tolerancia a erro de digitacao");
checa("SERVICO DE LIMPEZA URBANA", "limp", true, "prefixo de 4 letras ainda acha");

// 5. Consulta de 1 caractere nao e filtro — antes "a" devolvia a base inteira
//    como se fosse resultado de busca.
checa("QUALQUER CONTRATO", "a", true, "1 caractere passa reto");
checa("QUALQUER CONTRATO", "", true, "busca vazia passa reto");

// 6. Radical nao pode encurtar palavra curta a ponto de casar tudo.
if (radical("sao") !== "sao") {
  falhas++;
  console.error(`FALHOU: radical("sao") virou "${radical("sao")}" — palavra de 3 letras nao deve ser cortada`);
}

if (falhas) {
  console.error(`\n${falhas} falha(s) na busca do painel.`);
  process.exit(1);
}
console.log("OK: busca do painel casa plural, feminino, acento, sigla, numero e erro de digitacao.");
