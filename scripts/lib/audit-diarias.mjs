// Regra de qualidade das diarias: o dado publicado permite auditar valor,
// beneficiario e periodo, mas nao permite inferir a motivacao da viagem quando
// destino/finalidade/historico vem vazios da fonte. A regra descreve a lacuna;
// nunca completa o campo por suposicao nem trata a ausencia como irregularidade.
export function avaliarDetalhamentoDiarias(orgao, registros, ano) {
  const alvo = Number(ano);
  const atuais = (registros || []).filter((d) => Number(d.ano) === alvo);
  if (!atuais.length) return null;

  const semDestino = atuais.filter((d) => !String(d.destino || "").trim()).length;
  const semFinalidade = atuais.filter((d) => !String(d.finalidade || d.historico || "").trim()).length;
  if (!semDestino && !semFinalidade) return null;

  return {
    id: `diarias-${slug(orgao)}-sem-detalhamento`,
    titulo: `Diarias da ${orgao} com detalhamento incompleto`,
    descricao: `Em ${alvo}, a base tem ${atuais.length} registro(s): ${semDestino} sem destino e ${semFinalidade} sem finalidade. Valor, beneficiario e periodo continuam auditaveis quando preenchidos, mas a motivacao da viagem nao pode ser inferida.`,
    acao: "Conferir o ato original e solicitar destino, finalidade, relatorio de viagem e comprovantes antes de avaliar necessidade ou resultado da despesa.",
  };
}

function slug(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
