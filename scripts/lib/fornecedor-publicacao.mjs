// Fornecedor de uma publicação de contratação direta do Diário.
//
// Duas fontes imperfeitas: `envolvidos`, extraído do PDF por regex (às vezes
// perde o início do nome quando o trecho começa no meio), e `resumo`, texto
// limpo gerado pelo enriquecedor (nem sempre cita a empresa). Combinar as duas
// recupera o nome inteiro; quando nenhuma resolve, o resultado é vazio —
// atribuir compra a nome pela metade é pior que não identificar.

const SUFIXOS = "LTDA|EIRELI|EPP|S\\/A|S\\.A\\.?|ME|MEI|ASSOCIAÇÃO|COOPERATIVA|SOCIEDADE";
const RAZAO = new RegExp(
  `\\b([A-ZÀ-Ú][A-Za-zÀ-ú0-9&.,'\\-\\/ ]{3,70}?\\s(?:${SUFIXOS})\\b\\.?)`, "g");
const TRUNCADO = /^(?:d[aeo]s?|em|com|para|por|n[ao]s?)\s/i;
const ORGAO = /CISSUL|SAMU|Prefeitura|Funda[çc][ãa]o|CIMBASP|Cons[óo]rcio|Munic[íi]pio/i;
const PROSA = new Set([
  "A", "O", "AS", "OS", "EMPRESA", "EMPRESAS", "CONTRATADA", "CONTRATADO",
  "PREFEITURA", "VARGINHA", "FUNDAÇÃO", "MUNICÍPIO", "CONSÓRCIO", "CISSUL",
  "SAMU", "HOSPITAL", "SECRETARIA", "CÂMARA", "ATRAVÉS",
]);

const limpar = (s) => String(s || "").replace(/\s+/g, " ").replace(/[.,;:]+$/, "").trim();
const aceitavel = (n) => Boolean(n) && n.length >= 6 && !TRUNCADO.test(n) && !ORGAO.test(n);

/**
 * Recupera o início perdido de um nome procurando-o no texto limpo e andando
 * para a esquerda enquanto os tokens parecerem parte da razão social.
 */
export function repararNome(nomeParcial, texto) {
  const alvo = limpar(nomeParcial);
  if (!alvo) return "";
  const idx = String(texto || "").toUpperCase().indexOf(alvo.toUpperCase());
  if (idx <= 0) return "";

  const tokens = String(texto).slice(0, idx).trim().split(/\s+/);
  const recuperados = [];
  while (tokens.length) {
    const t = tokens[tokens.length - 1].replace(/[.,;:(]+$/, "");
    const pareceNome = /^[A-ZÀ-Ú0-9&][A-ZÀ-Ú0-9&.\-/]*$/.test(t)
      || /^[A-ZÀ-Ú][a-zà-ú]/.test(t);
    if (!pareceNome || PROSA.has(t.toUpperCase())) break;
    recuperados.unshift(t);
    tokens.pop();
  }
  if (!recuperados.length) return "";
  const inteiro = `${recuperados.join(" ")} ${String(texto).slice(idx, idx + alvo.length)}`;
  return limpar(inteiro);
}

/**
 * @returns {{nome: string, origem: "extrato"|"resumo"|"extrato reparado"|""}}
 */
export function fornecedorDaPublicacao(pub) {
  const resumo = String(pub?.resumo || "");
  const doExtrato = (pub?.envolvidos || [])
    .filter((e) => e?.papel === "empresa")
    .map((e) => limpar(e.nome))
    .filter(Boolean);

  // 1. Nome do extrato que já veio inteiro.
  const inteiro = doExtrato.find(aceitavel);

  // 2. Nome do extrato que perdeu o início — tenta recuperar pelo resumo.
  for (const parcial of doExtrato) {
    const reparado = repararNome(parcial, resumo);
    if (reparado && reparado.length > parcial.length && aceitavel(reparado)) {
      return { nome: reparado, origem: "extrato reparado" };
    }
  }
  if (inteiro) return { nome: inteiro, origem: "extrato" };

  // 3. Sem extrato utilizável: tenta o resumo direto.
  const doResumo = [...resumo.matchAll(RAZAO)].map((m) => limpar(m[1])).filter(aceitavel);
  if (doResumo.length) return { nome: doResumo[0], origem: "resumo" };

  return { nome: "", origem: "" };
}
