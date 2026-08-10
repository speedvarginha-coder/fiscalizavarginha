// Classificação jurídica de sanções CEIS/CNEP para fins de alerta público.
//
// Regra de ouro: falhar fechado. Quando o alcance não puder ser determinado a
// partir do campo oficial, o registro vai para revisão humana e NÃO entra em
// alerta nominal automático.
//
// A AUTORIDADE SOBRE O ALCANCE É O CAMPO `abrangencia`, devolvido pela API do
// Portal da Transparência (`abrangenciaDefinidaDecisaoJudicial`). O nome do
// tipo NÃO decide alcance: em 04/08/2026 a base tinha duas declarações de
// inidoneidade com abrangências diferentes — uma "Todas as Esferas em todos os
// Poderes", outra "Na Esfera e no Poder do órgão sancionador". Deduzir o
// alcance do rótulo "inidoneidade" publicou afirmação errada sobre a segunda.
//
// Base legal (Lei 14.133/2021, art. 156, §§4º e 5º) descreve o alcance típico
// de cada sanção, mas a decisão concreta pode restringi-lo — e é isso que o
// campo `abrangencia` registra.

const RE_VARGINHA = /VARGINHA/i;
const RE_INIDONEIDADE = /INIDON/i;
const RE_RESTRITIVA = /IMPEDIMENTO|PROIBI[ÇC][ÃA]O\s+DE\s+CONTRATAR|SUSPENS[ÃA]O/i;
const RE_MULTA = /MULTA/i;

/** Vocabulário observado no campo `abrangencia` do Portal. */
export const ABRANGENCIA = Object.freeze({
  GERAL: /TODAS\s+AS\s+ESFERAS/i,              // "Todas as Esferas em todos os Poderes"
  ESFERA_DO_ORGAO: /TODOS\s+OS\s+PODERES\s+DA\s+ESFERA/i,
  ESFERA_E_PODER: /NA\s+ESFERA\s+E\s+NO\s+PODER/i,
  SO_ORGAO: /NO\s+[ÓO]RG[ÃA]O\s+SANCIONADOR/i,
});

export const CATEGORIAS = Object.freeze({
  ALCANCE_GERAL: "alcance_geral",           // vale contra toda a administração pública
  ALCANCE_VARGINHA: "alcance_varginha",     // restrita, mas atinge Varginha
  OUTRO_ENTE: "outro_ente",                 // restrita a ente diverso
  MULTA: "multa",                           // pecuniária, não restringe contratar
  ALCANCE_DESCONHECIDO: "alcance_desconhecido",
  CONFLITO_ENTRE_CAMPOS: "conflito_entre_campos",
});

/** Só estas podem virar alerta com nome de empresa. */
const NOMINAVEIS = new Set([CATEGORIAS.ALCANCE_GERAL, CATEGORIAS.ALCANCE_VARGINHA]);

/** Campos sem os quais nenhum alerta nominal é permitido. */
export const CAMPOS_OBRIGATORIOS_NOMINAL = Object.freeze([
  "cnpj", "tipo", "fundamentacao", "abrangencia",
  "orgao_sancionador", "data_inicio", "numero_processo", "link_registro",
]);

// O registro oficial pode ser retificado, suspenso ou expirar. Uma revisao
// humana antiga nao autoriza manter o nome publicado indefinidamente.
export const VALIDADE_REVISAO_HUMANA_DIAS = 30;

/**
 * Campos de evidência ausentes no registro.
 * @returns {string[]}
 */
export function evidenciasFaltantes(a) {
  return CAMPOS_OBRIGATORIOS_NOMINAL.filter((c) => {
    const v = String(a?.[c] ?? "").trim();
    return !v || /^sem\s+informa/i.test(v);
  });
}

export function revisaoHumanaValida(a, agora = new Date(), validadeDias = VALIDADE_REVISAO_HUMANA_DIAS) {
  const revisao = a?.verificacao_manual;
  if (!revisao || typeof revisao !== "object") {
    return { valida: false, motivo: "verificacao manual ausente", idade_dias: null };
  }
  const obrigatorios = ["data_verificacao", "fonte", "verificado_por"];
  const faltantes = obrigatorios.filter((campo) => !String(revisao[campo] || "").trim());
  if (faltantes.length) {
    return { valida: false, motivo: `verificacao manual incompleta: ${faltantes.join(", ")}`, idade_dias: null };
  }
  const iso = paraIso(revisao.data_verificacao);
  const verificadaEm = iso ? new Date(`${iso}T00:00:00Z`) : new Date(NaN);
  if (Number.isNaN(verificadaEm.getTime())) {
    return { valida: false, motivo: "data da verificacao manual invalida", idade_dias: null };
  }
  const idadeDias = (agora - verificadaEm) / 86_400_000;
  if (idadeDias < -1) {
    return { valida: false, motivo: "data da verificacao manual esta no futuro", idade_dias: idadeDias };
  }
  if (idadeDias > validadeDias) {
    return { valida: false, motivo: `verificacao manual venceu ha ${Math.floor(idadeDias)} dias`, idade_dias: idadeDias };
  }
  return { valida: true, motivo: "verificacao manual vigente", idade_dias: idadeDias };
}

/**
 * Classifica uma sanção vigente pelo alcance oficial registrado.
 * @param {object} a registro de `sancoes.json > achados`
 */
export function classificarSancao(a) {
  const tipo = String(a?.tipo || "");
  const fundamento = `${a?.fundamentacao || ""} ${a?.fundamentacao_codigo || ""}`;
  const orgao = String(a?.orgao_sancionador || "");
  const abrangencia = String(a?.abrangencia || "").trim();
  const orgaoLocal = RE_VARGINHA.test(orgao);

  const pareceInidoneidade = RE_INIDONEIDADE.test(tipo) || RE_INIDONEIDADE.test(fundamento);
  const pareceRestritiva = RE_RESTRITIVA.test(tipo);
  const pareceMulta = RE_MULTA.test(tipo);

  // Tipo e fundamentação se contradizem: não se interpreta, bloqueia.
  if (pareceInidoneidade && pareceMulta && !pareceRestritiva) {
    return bloqueio("tipo indica multa e fundamentacao indica inidoneidade");
  }

  // Multa é sanção pecuniária: não restringe o direito de contratar, qualquer
  // que seja a abrangência. Nunca vira impedimento.
  if (pareceMulta && !pareceRestritiva && !pareceInidoneidade) {
    return ok(CATEGORIAS.MULTA, "sancao pecuniaria, sem efeito restritivo sobre contratar");
  }

  // Sem o campo oficial, o alcance não é deduzido do nome do tipo.
  if (!abrangencia || /^sem\s+informa/i.test(abrangencia)) {
    return ok(
      CATEGORIAS.ALCANCE_DESCONHECIDO,
      "campo de abrangencia ausente ou 'Sem Informacao' no registro oficial",
    );
  }

  if (ABRANGENCIA.GERAL.test(abrangencia)) {
    return ok(CATEGORIAS.ALCANCE_GERAL, `abrangencia oficial: ${abrangencia}`);
  }

  // Demais abrangências são restritas ao órgão, à esfera ou ao poder de quem
  // sancionou. Só alcançam Varginha se quem sancionou for órgão de Varginha.
  const restrita = ABRANGENCIA.ESFERA_DO_ORGAO.test(abrangencia)
    || ABRANGENCIA.ESFERA_E_PODER.test(abrangencia)
    || ABRANGENCIA.SO_ORGAO.test(abrangencia);

  if (!restrita) {
    return ok(
      CATEGORIAS.ALCANCE_DESCONHECIDO,
      `abrangencia "${abrangencia}" fora do vocabulario conhecido`,
    );
  }

  if (orgaoLocal) {
    return ok(CATEGORIAS.ALCANCE_VARGINHA, `restrita e aplicada por orgao de Varginha: ${abrangencia}`);
  }
  return ok(CATEGORIAS.OUTRO_ENTE, `restrita a ente diverso: ${abrangencia}`);
}

/**
 * Decide se o registro pode ser publicado com nome de empresa.
 * Exige categoria nominável E dossiê de evidências completo.
 */
export function podeNominar(a, { agora = new Date() } = {}) {
  const { categoria, nominavel, motivo } = classificarSancao(a);
  const faltantes = evidenciasFaltantes(a);
  if (!nominavel) {
    return { permitido: false, categoria, motivo, faltantes };
  }
  if (faltantes.length) {
    return {
      permitido: false,
      categoria,
      motivo: `evidencia incompleta: falta ${faltantes.join(", ")}`,
      faltantes,
    };
  }
  const revisao = revisaoHumanaValida(a, agora);
  if (!revisao.valida) {
    return {
      permitido: false,
      categoria,
      motivo: revisao.motivo,
      faltantes: ["verificacao_manual_valida"],
    };
  }
  return { permitido: true, categoria, motivo, faltantes: [] };
}

function ok(categoria, motivo) {
  return { categoria, nominavel: NOMINAVEIS.has(categoria), motivo };
}

function bloqueio(motivo) {
  return { categoria: CATEGORIAS.CONFLITO_ENTRE_CAMPOS, nominavel: false, motivo };
}

// --- Possível incompatibilidade contratual -------------------------------
//
// Sanção vigente NÃO prova contratação irregular. Para levantar a hipótese é
// preciso reunir, ao mesmo tempo: mesma raiz de CNPJ, contrato local, datas
// sobrepostas e alcance aplicável a Varginha. Faltando qualquer elo, o caso
// não é levantado — e mesmo reunido, o texto diz "possível incompatibilidade
// a esclarecer", nunca "contratação ilegal".

/** "25.863.390/****-**" e "25.863.390/0001-47" → "25863390". */
export function raizCnpj(cnpj) {
  const digitos = String(cnpj || "").replace(/\D/g, "");
  return digitos.length >= 8 ? digitos.slice(0, 8) : "";
}

/** Aceita dd/mm/aaaa e aaaa-mm-dd. Retorna aaaa-mm-dd ou "". */
export function paraIso(data) {
  const s = String(data || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/** Intervalos fechados se cruzam. Fim vazio = em aberto. */
export function periodosSobrepostos(iniA, fimA, iniB, fimB) {
  const a1 = paraIso(iniA), a2 = paraIso(fimA);
  const b1 = paraIso(iniB), b2 = paraIso(fimB);
  if (!a1 || !b1) return false;            // sem início não se afirma nada
  if (a2 && a2 < b1) return false;
  if (b2 && b2 < a1) return false;
  return true;
}

/**
 * Avalia se uma sanção e os contratos locais do mesmo CNPJ formam caso de
 * esclarecimento.
 * @param {object} sancao registro de sancoes.json
 * @param {object[]} contratos contratos locais (prefeitura/câmara)
 */
export function avaliarIncompatibilidade(sancao, contratos) {
  const { categoria, nominavel } = classificarSancao(sancao);
  const elos = {
    alcance_atinge_varginha: nominavel,
    dossie_completo: evidenciasFaltantes(sancao).length === 0,
    revisao_humana_valida: revisaoHumanaValida(sancao).valida,
    raiz_cnpj_confere: false,
    contrato_local: false,
    datas_sobrepostas: false,
  };

  const raiz = raizCnpj(sancao?.cnpj || sancao?.cnpj_raiz);
  const doMesmoCnpj = raiz
    ? (contratos || []).filter((c) => raizCnpj(c?.cnpj) === raiz)
    : [];
  elos.raiz_cnpj_confere = Boolean(raiz) && doMesmoCnpj.length > 0;
  elos.contrato_local = doMesmoCnpj.length > 0;

  const sobrepostos = doMesmoCnpj.filter((c) => periodosSobrepostos(
    c?.data_assinatura, c?.data_fim, sancao?.data_inicio, sancao?.data_fim,
  ));
  elos.datas_sobrepostas = sobrepostos.length > 0;

  const completo = Object.values(elos).every(Boolean);
  return {
    caso_para_esclarecimento: completo,
    categoria,
    elos,
    elos_faltantes: Object.entries(elos).filter(([, v]) => !v).map(([k]) => k),
    contratos_sobrepostos: sobrepostos,
  };
}

export function agruparSancoes(vigentes) {
  const grupos = Object.fromEntries(Object.values(CATEGORIAS).map((c) => [c, []]));
  for (const a of vigentes || []) {
    const { categoria, motivo } = classificarSancao(a);
    const { permitido, faltantes } = podeNominar(a);
    grupos[categoria].push({
      ...a,
      _motivo_classificacao: motivo,
      _pode_nominar: permitido,
      _evidencias_faltantes: faltantes,
    });
  }
  return grupos;
}
