// Agregação de um período para o resumo (semanal ou mensal).
// Só lê os chunks e devolve números — a renderização fica separada, para o
// mesmo cálculo servir a HTML, WhatsApp e teste.

const iso = (d) => d.toISOString().slice(0, 10);
const dataDe = (r, ...campos) => {
  for (const c of campos) {
    const v = String(r?.[c] || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  }
  return "";
};

/** Semana fechada (segunda a domingo) anterior à data de referência. */
export function semanaAnterior(hoje = new Date()) {
  const d = new Date(hoje);
  const diaSemana = (d.getUTCDay() + 6) % 7;      // 0 = segunda
  const domingo = new Date(d);
  domingo.setUTCDate(d.getUTCDate() - diaSemana - 1);
  const segunda = new Date(domingo);
  segunda.setUTCDate(domingo.getUTCDate() - 6);
  return { inicio: iso(segunda), fim: iso(domingo), tipo: "semanal" };
}

/**
 * Semana corrente, de segunda até o dia de referência.
 *
 * O post de sexta usa esta janela, não `semanaAnterior`: publicar na sexta a
 * semana fechada anterior entregaria fatos de 5 a 12 dias atrás, e o Diário da
 * própria semana — que é o que o leitor acabou de ver — ficaria de fora.
 */
export function semanaCorrente(hoje = new Date()) {
  const d = new Date(hoje);
  const diaSemana = (d.getUTCDay() + 6) % 7;      // 0 = segunda
  const segunda = new Date(d);
  segunda.setUTCDate(d.getUTCDate() - diaSemana);
  return { inicio: iso(segunda), fim: iso(d), tipo: "semanal" };
}

/** Mês fechado anterior à data de referência. */
export function mesAnterior(hoje = new Date()) {
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));
  const fim = new Date(d);
  fim.setUTCDate(0);
  const inicio = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth(), 1));
  return { inicio: iso(inicio), fim: iso(fim), tipo: "mensal" };
}

const noPeriodo = (data, ini, fim) => Boolean(data) && data >= ini && data <= fim;

/**
 * Explica ausência de produção legislativa com fatos observáveis, sem inferir
 * motivo que a base não comprove. "Não houve sessão" é fato; "está em recesso"
 * seria interpretação — só entra quando a ausência cobre o período inteiro e
 * fica rotulada como leitura, não como registro oficial.
 */
export function explicarAusencia({ materias, sessoes, inicio, fim }) {
  if (materias.length) return null;

  const datas = sessoes.map((s) => dataDe(s, "data")).filter(Boolean).sort();
  const anterior = datas.filter((d) => d < inicio).at(-1) || null;
  const posterior = datas.find((d) => d > fim) || null;
  const noIntervalo = datas.filter((d) => noPeriodo(d, inicio, fim));

  if (noIntervalo.length) {
    return {
      motivo: "sessoes_sem_materia",
      texto: `Houve ${noIntervalo.length} sessão(ões) no período, mas nenhuma matéria nova foi protocolada.`,
      sessao_anterior: anterior,
      sessao_posterior: posterior,
    };
  }
  return {
    motivo: "sem_sessao_no_periodo",
    texto: "Não houve sessão registrada no período, e nenhuma matéria foi protocolada.",
    sessao_anterior: anterior,
    sessao_posterior: posterior,
  };
}

export function agregarPeriodo(chunks, inicio, fim) {
  const anoInicio = inicio.slice(0, 4);
  const blocoCamara = chunks.camaraAnos?.[anoInicio] || {};
  const vereadores = new Set((blocoCamara.vereadores || []).map((v) => v.nome));

  const materias = (blocoCamara.materias || [])
    .filter((m) => noPeriodo(dataDe(m, "data"), inicio, fim));
  const sessoes = (blocoCamara.sessoes || []);
  const sessoesPeriodo = sessoes.filter((s) => noPeriodo(dataDe(s, "data"), inicio, fim));

  // Autoria: só vereador. Executivo, Mesa e comissões saem do ranking.
  const porVereador = new Map();
  for (const m of materias) {
    for (const autor of String(m.autor || "").split(",").map((s) => s.trim())) {
      if (!vereadores.has(autor)) continue;
      const atual = porVereador.get(autor) || { nome: autor, total: 0, tipos: {}, itens: [] };
      atual.total += 1;
      atual.tipos[m.sigla || m.tipo] = (atual.tipos[m.sigla || m.tipo] || 0) + 1;
      atual.itens.push(m);
      porVereador.set(autor, atual);
    }
  }
  const ranking = [...porVereador.values()].sort((a, b) => b.total - a.total);
  const deVereadores = materias.filter((m) => String(m.autor || "").split(",")
    .some((a) => vereadores.has(a.trim())));

  const contratosPref = (chunks.prefeitura?.contratos || [])
    .filter((c) => noPeriodo(dataDe(c, "data_assinatura"), inicio, fim));
  const contratosCam = (chunks.camaraBetha?.contratos || [])
    .filter((c) => noPeriodo(dataDe(c, "data_assinatura"), inicio, fim));
  const licitPref = [
    ...(chunks.prefeitura?.licit_finalizadas || []),
    ...(chunks.prefeitura?.licit_andamento || []),
  ].filter((l) => noPeriodo(dataDe(l, "data"), inicio, fim));
  const licitCam = (chunks.camaraBetha?.licitacoes || [])
    .filter((l) => noPeriodo(dataDe(l, "data"), inicio, fim));

  const diretas = (chunks.publicacoesDiario?.publicacoes || [])
    .filter((p) => /dispensa|inexig/i.test(p.tipo || ""))
    .filter((p) => noPeriodo(dataDe(p, "data"), inicio, fim));

  // Diárias entram pela data inicial da viagem e usam `valor_total`
  // (`valor` nao existe nesse chunk e somaria zero em silencio).
  const diariasDe = (lista) => (lista || [])
    .filter((d) => noPeriodo(dataDe(d, "data_inicial"), inicio, fim));
  const diariasPref = diariasDe(chunks.diarias?.prefeitura);
  const diariasCam = diariasDe(chunks.diarias?.camara);

  const soma = (arr, campo = "valor") => arr.reduce((s, x) => s + (Number(x?.[campo]) || 0), 0);
  const porModalidade = {};
  for (const c of contratosPref) {
    const k = c.modalidade || "(sem modalidade)";
    porModalidade[k] = porModalidade[k] || { qtd: 0, valor: 0 };
    porModalidade[k].qtd += 1;
    porModalidade[k].valor += Number(c.valor) || 0;
  }

  return {
    periodo: { inicio, fim },
    legislativo: {
      materias_total: materias.length,
      materias_de_vereadores: deVereadores.length,
      sessoes: sessoesPeriodo,
      ranking,
      ausencia: explicarAusencia({ materias: deVereadores, sessoes, inicio, fim }),
    },
    compras: {
      contratos_prefeitura: contratosPref,
      contratos_camara: contratosCam,
      valor_contratos_prefeitura: soma(contratosPref),
      valor_contratos_camara: soma(contratosCam),
      licitacoes_prefeitura: licitPref,
      licitacoes_camara: licitCam,
      contratacao_direta_publicada: diretas,
      valor_contratacao_direta: diretas.reduce((s, p) => s + (Number(p?.valores?.total) || 0), 0),
      por_modalidade: porModalidade,
      diarias_prefeitura: diariasPref,
      diarias_camara: diariasCam,
      valor_diarias_prefeitura: soma(diariasPref, "valor_total"),
      valor_diarias_camara: soma(diariasCam, "valor_total"),
    },
  };
}
