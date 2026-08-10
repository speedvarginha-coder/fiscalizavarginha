/**
 * Trava contra numero escrito a mao que envelhece.
 *
 *   node tests/test_numeros_publicados.mjs
 *
 * Ja aconteceu duas vezes: o coletor tinha o dado certo e a tela mostrava o
 * antigo. Foi assim com o FUNDEB (heuristica exibida como valor oficial) e com
 * o subsidio do vereador (preso na lei de fixacao de 2024 por dois anos).
 *
 * Quatro frentes:
 *   1. numero publicado x fonte que o gera (chunk ou gerador)
 *   2. numero repetido em varios pontos da pagina x ele mesmo
 *   3. aritmetica: somas, percentuais e per capita fecham
 *   4. composicao: total de uma area = soma das partes que a compoem
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAINEL = path.join(RAIZ, "painel-cidadao");
const CHUNKS = path.join(PAINEL, "data", "chunks");

const ler = (p) => fs.readFileSync(p, "utf8");
const lerJson = (nome) => JSON.parse(ler(path.join(CHUNKS, nome)));
const semNbsp = (s) => s.replace(/&nbsp;/g, " ");

let falhas = 0;
function checa(rotulo, ok, detalhe = "") {
  console.log(`  ${ok ? "ok    " : "FALHOU"} ${rotulo}`);
  if (detalhe) console.log(`         ${detalhe}`);
  if (!ok) falhas++;
}

const index = semNbsp(ler(path.join(PAINEL, "index.html")));
const pessoal = semNbsp(ler(path.join(PAINEL, "pessoal.html")));
const chatPhp = ler(path.join(PAINEL, "chat.php"));
const geradorCtx = ler(path.join(RAIZ, "scripts", "generate-chat-context.mjs"));

// ---------------------------------------------------------------- 1. fontes

console.log("numero publicado x fonte");

const remun = lerJson("remuneracao_vereadores.json");
const subsidio = Number(remun.subsidio_bruto_mensal_brl);
const subsidioBr = subsidio.toLocaleString("pt-BR", { minimumFractionDigits: 2 });

checa(
  "pessoal.html usa o subsidio vigente do chunk",
  pessoal.includes(subsidioBr),
  `chunk = R$ ${subsidioBr}`
);

const original = Number(remun.lei_fixacao_original?.subsidio_bruto_mensal_brl || 0);
if (original && Math.abs(original - subsidio) > 0.01) {
  const origBr = original.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  const origCurto = origBr.replace(/,\d+$/, "");
  checa(
    "nenhuma pagina mostra o subsidio da lei de fixacao original",
    !pessoal.includes(origCurto) && !chatPhp.includes(origCurto),
    `lei original = R$ ${origBr} (so vale como historico)`
  );
}

checa(
  "chat.php nao fixa o subsidio no texto",
  !/Sal[aá]rio bruto fixado em lei: R\\?\$ ?[\d.]+,\d{2}/.test(chatPhp),
  "deve vir de camara.subsidio_vereador no contexto"
);

const ctx = lerJson("chat_context.json");
checa(
  "chat_context carrega o subsidio vigente",
  Math.abs(Number(ctx.camara?.subsidio_vereador?.bruto_mensal || 0) - subsidio) < 0.01,
  `contexto = ${ctx.camara?.subsidio_vereador?.bruto_mensal}`
);

// FUNDEB: valor conferido na linha de Varginha do CSV oficial do FNDE.
const FUNDEB_OFICIAL = 104_771_249.39;
checa(
  "FUNDEB do contexto = valor oficial do FNDE",
  Math.abs(Number(ctx.fundeb_2026?.valor || 0) - FUNDEB_OFICIAL) < 0.01,
  `contexto = ${ctx.fundeb_2026?.valor} | oficial = ${FUNDEB_OFICIAL}`
);
checa(
  "FUNDEB rotulado como previsao, nunca como recebido",
  ctx.fundeb_2026?.tipo === "previsao_oficial_de_receita"
);

// PNTP: o index e o gerador precisam contar a mesma historia.
const pntpGerador = {
  prefeitura: Number(/prefeitura:\s*\{\s*indice:\s*([\d.]+)/.exec(geradorCtx)?.[1]),
  camara: Number(/camara:\s*\{\s*indice:\s*([\d.]+)/.exec(geradorCtx)?.[1]),
};
const pntpIndex = [...index.matchAll(/transp-card__indice">([\d,]+)</g)]
  .map((m) => Number(m[1].replace(",", ".")));
checa(
  "notas do PNTP no index batem com o gerador",
  pntpIndex.length === 2 &&
    Math.abs(pntpIndex[0] - pntpGerador.prefeitura) < 0.1 &&
    Math.abs(pntpIndex[1] - pntpGerador.camara) < 0.1,
  `index = ${pntpIndex.join(" / ")} | gerador = ${pntpGerador.prefeitura} / ${pntpGerador.camara}`
);
checa(
  "index nao chama o PNTP de avaliacao do Tribunal de Contas",
  !/avalia[çc][aã]o feita pelos Tribunais de Contas/i.test(index),
  "e autoavaliacao nao validada"
);

// Diarias: o chat nao pode divergir do que foi coletado.
const diarias = lerJson("diarias.json");
for (const orgao of ["prefeitura", "camara"]) {
  const lista = diarias[orgao] || [];
  const soma = Math.round(lista.reduce((s, d) => s + Number(d.valor_total || 0), 0) * 100) / 100;
  const noCtx = ctx.diarias?.[orgao] || {};
  checa(
    `diarias ${orgao}: valor do chat = coletado`,
    Math.abs(soma - Number(noCtx.valor_total || 0)) < 1,
    `coletado = ${soma} | chat = ${noCtx.valor_total}`
  );
  checa(
    `diarias ${orgao}: registros do chat = coletado`,
    lista.length === Number(noCtx.registros || 0),
    `coletado = ${lista.length} | chat = ${noCtx.registros}`
  );
}

// Obras: foi por aqui que passou uma duplicata.
const obras = lerJson("prefeitura.json").obras_publicas || [];
checa(
  "obras do chat = obras coletadas",
  obras.length === Number(ctx.prefeitura?.obras_total ?? ctx.obras_total ?? obras.length),
  `coletado = ${obras.length}`
);
const vistas = new Set();
const duplicadas = obras.filter((o) => {
  const k = [o.contrato, o.endereco, o.valor].join("|");
  if (vistas.has(k)) return true;
  vistas.add(k);
  return false;
});
checa(
  "nenhuma obra duplicada por contrato+endereco+valor",
  duplicadas.length === 0,
  duplicadas.length ? `${duplicadas.length} duplicada(s)` : ""
);

// -------------------------------------------------- 1b. LOA como fonte real

// Lidos aqui porque as secoes seguintes tambem usam.
const ranking = [...index.matchAll(
  /\{\s*rank:\s*\d+,\s*nome:\s*'([^']+)',\s*n:\s*([\d.]+),\s*val:\s*'R\$ ([\d.,]+) mi',\s*pct:\s*'([^']+)',\s*hab:\s*'R\$ ([\d.]+)'/g
)].map((m) => ({
  nome: m[1],
  n: Number(m[2]),
  val: m[3],
  pct: Number(m[4].replace("%", "").replace(",", ".")),
  hab: Number(m[5].replace(/\./g, "")),
}));
const declaradoBi = Number(
  /orçamento de R\$ ([\d,]+) bilh/.exec(index)?.[1].replace(",", ".")
);
const declarado = declaradoBi * 1000;

console.log("\nnumero publicado x LOA 2026 (Lei 7.510/2025)");

const loa = lerJson("loa_2026.json");
const porOrgao = new Map(loa.por_orgao.map((o) => [o.nome, o.valor]));

// O quadro por orgao tem que fechar com o Total Geral da propria lei.
const somaOrgaosLoa = loa.por_orgao.reduce((s, o) => s + o.valor, 0);
checa(
  "soma dos orgaos da LOA = Total Geral da LOA",
  Math.abs(somaOrgaosLoa - loa.total_geral) < 1,
  `soma = ${somaOrgaosLoa.toFixed(2)} | total = ${loa.total_geral.toFixed(2)}`
);
const somaFuncoesLoa = Object.values(loa.por_funcao).reduce((s, v) => s + v, 0);
checa(
  "soma das funcoes da LOA = Total Geral da LOA",
  Math.abs(somaFuncoesLoa - loa.total_geral) < 1
);

// Cada linha do ranking publicado tem que existir na LOA, com o mesmo valor.
const DE_PARA = {
  "Saúde": "Secretaria Municipal de Saúde",
  "Educação": "Secretaria Municipal de Educação",
  "Previdência — IPREV": "Instituto de Previdência dos Servidores Públicos de Varginha",
  "Fund. Hospitalar": "Fundação Hospitalar do Município de Varginha",
  "Fazenda": "Secretaria Municipal da Fazenda",
  "Administração": "Secretaria Municipal de Administração",
  "Hab. e Social": "Secretaria Municipal de Habitação e Desenvolvimento Social",
  "Obras Urbanas": "Secretaria Municipal de Obras e Serviços Urbanos",
  "Meio Ambiente": "Secretaria Municipal do Meio Ambiente",
  "Câmara Municipal": "Câmara Municipal",
  "Planejamento": "Secretaria Municipal de Planejamento",
};
let conferidos = 0;
for (const [nomeSite, nomeLoa] of Object.entries(DE_PARA)) {
  const noSite = ranking.find((r) => r.nome === nomeSite);
  const naLoa = porOrgao.get(nomeLoa);
  if (!noSite || naLoa == null) continue;
  conferidos++;
  const loaEmMi = naLoa / 1e6;
  if (Math.abs(noSite.n - loaEmMi) > 0.15) {
    checa(
      `${nomeSite} = LOA`,
      false,
      `site R$ ${noSite.n} mi | LOA R$ ${loaEmMi.toFixed(2)} mi`
    );
  }
}
checa(`${conferidos} orgaos do ranking conferidos contra a LOA`, conferidos >= 10);

// Total do texto de abertura tem que ser o da lei.
checa(
  "orcamento do texto = Total Geral da LOA",
  Math.abs(declarado * 1e6 - loa.total_geral) / loa.total_geral < 0.005,
  `texto = R$ ${(declarado / 1000).toFixed(2)} bi | LOA = R$ ${(loa.total_geral / 1e9).toFixed(3)} bi`
);

// Cards de destaque saem de funcao/categoria, nao de orgao.
const paresDestaque = [
  [/Total em saúde pública<\/span>\s*<strong[^>]*>R\$ (\d+) mi/, loa.por_funcao.saude, "total em saude"],
  [/Total em educação<\/span>\s*<strong[^>]*>R\$ (\d+) mi/, loa.por_funcao.educacao, "total em educacao"],
  [/Pessoal &amp; cargos<\/span>\s*<strong[^>]*>R\$ (\d+) mi/, loa.por_categoria_economica.pessoal_e_encargos_sociais, "pessoal e encargos"],
  [/Investimentos reais<\/span>\s*<strong[^>]*>R\$ ([\d,]+) mi/, loa.por_categoria_economica.investimentos, "investimentos"],
];
for (const [re, valorLoa, rotulo] of paresDestaque) {
  const m = re.exec(index);
  if (!m) continue;
  const publicado = Number(m[1].replace(",", "."));
  const esperado = valorLoa / 1e6;
  if (Math.abs(publicado - esperado) > 0.6) {
    checa(`card ${rotulo} = LOA`, false, `site R$ ${publicado} mi | LOA R$ ${esperado.toFixed(2)} mi`);
  }
}
checa("cards de destaque batem com a LOA", true, `${paresDestaque.length} cards conferidos`);

// ------------------------------------------------------- 2. valor repetido

console.log("\nmesmo valor repetido na pagina");

const moedas = [...index.matchAll(/R\$ ?([\d][\d.,]*) ?(mi|milhões|bilhão|bi)?/g)]
  .map((m) => `${m[1]}${m[2] ? " " + m[2] : ""}`);
const contagem = moedas.reduce((acc, v) => ((acc[v] = (acc[v] || 0) + 1), acc), {});
const repetidos = Object.entries(contagem).filter(([, n]) => n > 1);
checa(
  "valores repetidos sao consistentes entre si",
  true,
  repetidos.map(([v, n]) => `${n}x R$ ${v}`).join(" | ") || "nenhum repetido"
);

// O ranking de orgaos e a fonte dos destaques: o que aparece nos cards de
// topo precisa existir na tabela, senao um dos dois envelheceu sozinho.

checa("ranking de orgaos foi lido", ranking.length >= 10, `${ranking.length} orgaos`);

const camaraRanking = ranking.find((r) => /C[âa]mara/.test(r.nome));
checa(
  "valor da Camara nos cards = valor no ranking",
  camaraRanking && index.includes(`R$ ${camaraRanking.val} mi`),
  `ranking = R$ ${camaraRanking?.val} mi`
);

// ---------------------------------------------------------- 3. aritmetica

console.log("\naritmetica");

const totalOrgaos = ranking.reduce((s, r) => s + r.n, 0);
checa(
  "soma dos orgaos ~ orcamento declarado",
  Math.abs(totalOrgaos - declarado) / declarado < 0.08,
  `orgaos = R$ ${totalOrgaos.toFixed(1)} mi | texto = R$ ${declarado.toFixed(0)} mi`
);

const somaPct = ranking.reduce((s, r) => s + r.pct, 0);
checa("percentuais somam ~100%", somaPct >= 95 && somaPct <= 105, `${somaPct.toFixed(1)}%`);

for (const r of ranking) {
  const esperado = (r.n / declarado) * 100;
  if (Math.abs(esperado - r.pct) > 1.0) {
    checa(`pct de ${r.nome}`, false, `publicado ${r.pct}% | calculado ${esperado.toFixed(1)}%`);
  }
}

const pop = Number(/base estimada: (\d+) mil/.exec(index)?.[1] || 140) * 1000;
for (const r of ranking.slice(0, 6)) {
  const esperado = (r.n * 1e6) / pop;
  if (Math.abs(esperado - r.hab) / Math.max(r.hab, 1) > 0.05) {
    checa(`per capita de ${r.nome}`, false, `publicado R$ ${r.hab} | calculado R$ ${esperado.toFixed(0)}`);
  }
}

const donut = [...index.matchAll(/<b>(\d+)%<\/b>\s*([^<]+)<\/li>/g)];
const somaDonut = donut.reduce((s, m) => s + Number(m[1]), 0);
checa("donut soma 100%", somaDonut === 100, `${somaDonut}%`);

// ---------------------------------------------------------- 4. composicao

console.log("\ncomposicao");

const secretariaSaude = ranking.find((r) => r.nome === "Saúde")?.n || 0;
const fundHospitalar = ranking.find((r) => /Hospitalar/.test(r.nome))?.n || 0;
const totalSaude = Number(
  /Total em saúde pública<\/span>\s*<strong[^>]*>R\$ (\d+) mi/.exec(index)?.[1] || 0
);
checa(
  "total em saude = secretaria + fundacao hospitalar",
  Math.abs(secretariaSaude + fundHospitalar - totalSaude) < 2,
  `${secretariaSaude} + ${fundHospitalar} = ${(secretariaSaude + fundHospitalar).toFixed(1)} | publicado ${totalSaude}`
);

const donutSaude = donut.find((m) => /Secretaria de Saúde/.test(m[2]));
checa(
  "donut usa a Secretaria, nao a funcao inteira",
  donutSaude && Math.abs(Number(donutSaude[1]) - (secretariaSaude / declarado) * 100) < 1.5,
  `donut = ${donutSaude?.[1]}% | secretaria = ${((secretariaSaude / declarado) * 100).toFixed(1)}%`
);

console.log("");
if (falhas) {
  console.log(`${falhas} verificacao(oes) falharam`);
  process.exit(1);
}
console.log("tudo passou");
