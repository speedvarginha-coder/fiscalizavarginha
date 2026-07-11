const payload = window.EMENDAS_DATA || { metadata: {}, emendas: [] };
// Lote municipal da 20ª Legislatura (2025-2028), gerado por gerar_municipais_atuais.py
const municipaisAtuais = (window.EMENDAS_MUNICIPAIS_ATUAIS && window.EMENDAS_MUNICIPAIS_ATUAIS.emendas) || [];
// Emendas federais do Portal da Transparência (CGU), carregadas de data/emendas_federais.js
const federais = (window.EMENDAS_FEDERAIS && window.EMENDAS_FEDERAIS.emendas) || [];
const estaduaisNormalizadas = (window.EMENDAS_ESTADUAIS_NORMALIZADAS && window.EMENDAS_ESTADUAIS_NORMALIZADAS.emendas) || [];
const baseSemEstaduais = (payload.emendas || []).filter((record) => record.tipo !== "Estadual");
const allRecords = [...baseSemEstaduais, ...estaduaisNormalizadas, ...municipaisAtuais, ...federais].map(normalizeRecord);

function knownMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "string"
    ? Number(value.replace(/\./g, "").replace(",", "."))
    : Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstMoney(record, keys) {
  for (const key of keys) {
    const value = knownMoney(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function normalizeRecord(record) {
  const category = normalize(record.categoria || record.modalidade || record.descricao);
  const author = normalize(record.autor);
  let autoriaTipo = "Individual";
  if (category.includes("bancada") || author.includes("bancada")) autoriaTipo = "Bancada";
  else if (category.includes("comissao") || author.includes("comissao") || author.startsWith("com.")) autoriaTipo = "Comissão";
  else if (category.includes("relator") || author.includes("relator")) autoriaTipo = "Relator";

  let modalidade = "N/D";
  if (/pix|transferencia especial/.test(category)) modalidade = "Pix";
  else if (/finalidade definida/.test(category)) modalidade = "Finalidade definida";
  else if (/fundo a fundo/.test(category)) modalidade = "Fundo a fundo";
  else if (/contrato de repasse/.test(category)) modalidade = "Contrato de repasse";
  else if (/convenio/.test(category)) modalidade = "Convênio";

  const indicadoExplicito = firstMoney(record, ["valorIndicado", "valorEmenda", "valorIndicacao"]);
  const empenhado = firstMoney(record, ["valorEmpenhado", "empenhado"]);
  const pago = firstMoney(record, ["valorPago", "valorTransferido", "pago", "transferido"]);
  const recebidoExplicito = firstMoney(record, ["valorRecebido", "recebido"]);
  const executado = firstMoney(record, ["valorExecutado", "executado"]);
  const legado = knownMoney(record.valor);
  const indicado = indicadoExplicito ?? (record.tipo === "Municipal" ? legado : null);
  const recebido = recebidoExplicito ?? (
    record.tipo === "Federal" && !record.somenteNoBetha
      ? (record.valorPago ?? (record.dadosBetha ? knownMoney(record.dadosBetha.valorBetha) : null))
      : null
  );
  const pagoTransferido = pago ?? (
    record.tipo === "Federal" && !record.somenteNoBetha
      ? (record.valorPago ?? (record.dadosBetha ? knownMoney(record.dadosBetha.valorBetha) : null))
      : null
  );
  const stages = { indicado, empenhado, pago: pagoTransferido, recebido, executado };
  const explicitValues = Object.values(stages).filter((value) => value !== null);
  const inconsistent = (executado !== null && recebido !== null && executado > recebido) ||
    (recebido !== null && pagoTransferido !== null && recebido > pagoTransferido);
  let comprovacao = record.comprovacao || record.selo || record.qualidadeDado || record.classificacaoComprovacao || "";
  const allowed = ["Confirmado", "Conciliado", "Parcial", "Inferido", "Sem comprovação", "Inconsistente"];
  comprovacao = allowed.find((label) => normalize(label) === normalize(comprovacao)) || "";
  if (inconsistent) comprovacao = "Inconsistente";
  else if (!comprovacao && record.tipo === "Federal" && recebido !== null) {
    comprovacao = record.dadosBetha ? "Conciliado" : "Confirmado";
  }
  else if (!comprovacao && record.dadosBetha && recebido !== null) comprovacao = "Conciliado";
  else if (!comprovacao && explicitValues.length) comprovacao = record.tipo === "Municipal" ? "Inferido" : "Parcial";
  else if (!comprovacao) comprovacao = "Sem comprovação";

  return { ...record, autoriaTipo, modalidade, comprovacao, stages };
}

// Os PDFs não são hospedados aqui (versão leve). Os links levam à fonte oficial
// de cada esfera: municipais à Câmara; estaduais/federais ao Portal Betha.
function fonteOficialUrl(record) {
  // Registro pode trazer link direto da fonte (ex.: emendas federais → Portal da Transparência)
  if (record && record.fonteUrl) return record.fonteUrl;
  const tipo = (record && record.tipo ? record.tipo : "").toLowerCase();
  if (tipo.includes("municip")) {
    return "https://www.varginha.mg.leg.br/atividade-legislativa/emendas/emendas-impositivas";
  }
  return "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/295943";
}

const state = {
  page: 1,
  pageSize: 12,
  quick: "",
  beneficiaryCanonical: "",
  currentDetailId: "",
  rankRole: "",           // filtro de cargo dos rankings: "Senador(a)" | "Dep. Federal" | ""
  authorSort: "valor",    // ordenação do painel Vereadores: "valor" | "quantidade"
  deputySort: "valor",    // ordenação do painel Deputados/Senadores: "valor" | "quantidade"
  deputyRole: "",         // cargo no painel Deputados/Senadores: "Dep. Federal" | "Dep. Estadual" | "Senador(a)" | ""
  filtered: [...allRecords],
};

const elements = {
  lastUpdate: document.querySelector("#lastUpdate"),
  metricCount: document.querySelector("#metricCount"),
  metricIndicated: document.querySelector("#metricIndicated"),
  metricCommitted: document.querySelector("#metricCommitted"),
  metricPaid: document.querySelector("#metricPaid"),
  metricReceived: document.querySelector("#metricReceived"),
  metricExecuted: document.querySelector("#metricExecuted"),
  searchInput: document.querySelector("#searchInput"),
  typeFilter: document.querySelector("#typeFilter"),
  yearFilter: document.querySelector("#yearFilter"),
  resourceYearFilter: document.querySelector("#resourceYearFilter"),
  orgFilter: document.querySelector("#orgFilter"),
  categoryFilter: document.querySelector("#categoryFilter"),
  authorshipFilter: document.querySelector("#authorshipFilter"),
  modalityFilter: document.querySelector("#modalityFilter"),
  evidenceFilter: document.querySelector("#evidenceFilter"),
  stageFilter: document.querySelector("#stageFilter"),
  activeFilter: document.querySelector("#activeFilter"),
  partyFilter: document.querySelector("#partyFilter"),
  authorFilter: document.querySelector("#authorFilter"),
  beneficiaryFilter: document.querySelector("#beneficiaryFilter"),
  beneficiaryOptions: document.querySelector("#beneficiaryOptions"),
  approvalFilter: document.querySelector("#approvalFilter"),
  individualFilter: document.querySelector("#individualFilter"),
  sortFilter: document.querySelector("#sortFilter"),
  minValue: document.querySelector("#minValue"),
  maxValue: document.querySelector("#maxValue"),
  clearFilters: document.querySelector("#clearFilters"),
  exportCsv: document.querySelector("#exportCsv"),
  typeTotal: document.querySelector("#typeTotal"),
  typeChart: document.querySelector("#typeChart"),
  orgChart: document.querySelector("#orgChart"),
  recipientTotal: document.querySelector("#recipientTotal"),
  recipientRanking: document.querySelector("#recipientRanking"),
  associationTotal: document.querySelector("#associationTotal"),
  associationRanking: document.querySelector("#associationRanking"),
  authorTotal: document.querySelector("#authorTotal"),
  authorRanking: document.querySelector("#authorRanking"),
  authorSum: document.querySelector("#authorSum"),
  deputyTotal: document.querySelector("#deputyTotal"),
  deputyRanking: document.querySelector("#deputyRanking"),
  deputySum: document.querySelector("#deputySum"),
  institutionalTotal: document.querySelector("#institutionalTotal"),
  institutionalRanking: document.querySelector("#institutionalRanking"),
  transparencyFlags: document.querySelector("#transparencyFlags"),
  notApprovedTotal: document.querySelector("#notApprovedTotal"),
  notApprovedSituation: document.querySelector("#notApprovedSituation"),
  topValuePanels: document.querySelector("#topValuePanels"),
  results: document.querySelector("#results"),
  resultSummary: document.querySelector("#resultSummary"),
  pageInfo: document.querySelector("#pageInfo"),
  prevPage: document.querySelector("#prevPage"),
  nextPage: document.querySelector("#nextPage"),
  detailDialog: document.querySelector("#detailDialog"),
  detailType: document.querySelector("#detailType"),
  detailTitle: document.querySelector("#detailTitle"),
  detailBody: document.querySelector("#detailBody"),
  shareDetail: document.querySelector("#shareDetail"),
  closeDialog: document.querySelector("#closeDialog"),
};

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const numberFormatter = new Intl.NumberFormat("pt-BR");

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Titulares em exercício na 20ª Legislatura (2025-2028), consultados no SAPL
// em 03/07/2026. O ID permite conferir cada cadastro na fonte oficial.
const CURRENT_COUNCILLORS_SOURCE = "https://sapl.varginha.mg.leg.br/parlamentar/";
const LOCAL_COUNCILLORS = {
  "afonso monticeli": { name: "AFONSO MONTICELI", party: "MOBILIZA", active: true, saplId: 159 },
  "afonso celso monticeli filho": { name: "AFONSO MONTICELI", party: "MOBILIZA", active: true, saplId: 159 },
  "alexandre prado": { name: "ALEXANDRE PRADO", party: "AVANTE", active: true, saplId: 161 },
  "ana rios fontoura": { name: "ANA RIOS", party: "UNIÃO BRASIL", active: true, saplId: 162 },
  "ana rios": { name: "ANA RIOS", party: "UNIÃO BRASIL", active: true, saplId: 162 },
  "bruno leandro coletor": { name: "BRUNO LEANDRO COLETOR", party: "PSDB", active: true, saplId: 164 },
  "bruno leandro de souza": { name: "BRUNO LEANDRO COLETOR", party: "PSDB", active: true, saplId: 164 },
  "cassio chiodi": { name: "CÁSSIO CHIODI", party: "SOLIDARIEDADE", active: true, saplId: 166 },
  "cassio mendonca bosque chiodi": { name: "CÁSSIO CHIODI", party: "SOLIDARIEDADE", active: true, saplId: 166 },
  "dandan": { name: "DANDAN", party: "PL", active: true, saplId: 6 },
  "daniel rodrigues de farias": { name: "DANDAN", party: "PL", active: true, saplId: 6 },
  "davi martins": { name: "DAVI MARTINS", party: "PL", active: true, saplId: 163 },
  "carlos davi de sousa martins": { name: "DAVI MARTINS", party: "PL", active: true, saplId: 163 },
  "carlos davi de souza martins": { name: "DAVI MARTINS", party: "PL", active: true, saplId: 163 },
  "dudu ottoni": { name: "DUDU OTTONI", party: "AVANTE", active: true, saplId: 9 },
  "eduardo benedito ottoni filho": { name: "DUDU OTTONI", party: "AVANTE", active: true, saplId: 9 },
  "joaozinho enfermeiro": { name: "JOÃOZINHO ENFERMEIRO", party: "DC", active: true, saplId: 10 },
  "joao martins ribeiro": { name: "JOÃOZINHO ENFERMEIRO", party: "DC", active: true, saplId: 10 },
  "miguel da saude": { name: "MIGUEL DA SAÚDE", party: "PSD", active: true, saplId: 167 },
  "miguel jose de lima": { name: "MIGUEL DA SAÚDE", party: "PSD", active: true, saplId: 167 },
  "pastor faustinho": { name: "PASTOR FAUSTINHO", party: "PSD", active: true, saplId: 165 },
  "fausto da silva franca junior": { name: "PASTOR FAUSTINHO", party: "PSD", active: true, saplId: 165 },
  "rogerio bueno": { name: "ROGÉRIO BUENO", party: "PV", active: true, saplId: 28 },
  "rogerio bernardes bueno": { name: "ROGÉRIO BUENO", party: "PV", active: true, saplId: 28 },
  "thulyo paiva": { name: "THULYO PAIVA", party: "UNIÃO BRASIL", active: true, saplId: 14 },
  "thulyo paiva machado": { name: "THULYO PAIVA", party: "UNIÃO BRASIL", active: true, saplId: 14 },
  "ze morais": { name: "ZÉ MORAIS", party: "AVANTE", active: true, saplId: 48 },
  "jose vicente de morais": { name: "ZÉ MORAIS", party: "AVANTE", active: true, saplId: 48 },
  "zilda silva": { name: "ZILDA SILVA", party: "PP", active: true, saplId: 15 },
  "zilda maria da silva": { name: "ZILDA SILVA", party: "PP", active: true, saplId: 15 }
};

const DEPUTY_PARTIES = {
  "greyce de queiroz elias": { party: "AVANTE" },
  "bruno engler": { party: "PL" },
  "mauro tramonte": { party: "REPUBLICANOS" },
  "noraldino junior": { party: "PSB" },
  "diego andrade": { party: "PSD" },
  "mario henrique caixa": { party: "PV" },
  "charles evangelista": { party: "PP" },
  "lafayette de andrada": { party: "REPUBLICANOS" },
  "dimas fabiano": { party: "PP" },
  "damares alves": { party: "REPUBLICANOS" },
  "rodrigo pacheco": { party: "PSD" },
  "nikolas ferreira": { party: "PL" },
  "cleitinho": { party: "REPUBLICANOS" },
  "reginaldo lopes": { party: "PT" },
  "odair cunha": { party: "PT" }
};

function getAuthorMeta(record) {
  const authorLabel = canonicalAuthorLabel(record);
  const authorKey = normalize(authorLabel);
  
  let party = canonicalPartyLabel(record);
  // Para registros municipais, ausência no cadastro oficial nunca significa "ativo".
  let active = record.tipo !== "Municipal";
  let role = parliamentaryRole(record.tipo);
  let name = authorLabel;

  if (record.tipo === "Municipal") {
    const lookupKey = Object.keys(LOCAL_COUNCILLORS).find(k => authorKey.includes(k));
    if (lookupKey) {
      const meta = LOCAL_COUNCILLORS[lookupKey];
      name = meta.name;
      party = meta.party;
      active = meta.active;
    }
  } else {
    const lookupKey = Object.keys(DEPUTY_PARTIES).find(k => authorKey.includes(k));
    if (lookupKey) {
      party = DEPUTY_PARTIES[lookupKey].party;
    }
  }

  return { name, party, active, role: authorRole(record) };
}

function dateToNumber(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return 0;
  return Number(`${match[3]}${match[2]}${match[1]}`);
}

function yearsForRecord(record) {
  if (Array.isArray(record.anosRelacionados) && record.anosRelacionados.length) {
    return record.anosRelacionados.filter((year) => year !== "1800").sort();
  }

  const years = new Set();
  [record.ano, record.anoEmenda, record.anoRecurso, record.dataRecurso, record.dataPlano, record.emenda, record.descricao, record.objeto]
    .filter(Boolean)
    .forEach((value) => {
      String(value)
        .match(/\b(?:19|20)\d{2}\b/g)
        ?.forEach((year) => years.add(year));
    });
  return [...years].filter((year) => year !== "1800").sort();
}

function amendmentYearsForRecord(record) {
  if (record.anoEmenda) return [record.anoEmenda];

  const emenda = String(record.emenda || "");
  const directMatch = emenda.match(/(?:^|[/\.\s-])((?:19|20)\d{2})(?:$|\D)/);
  if (directMatch) return [directMatch[1]];

  const compact = emenda.replace(/\D/g, "");
  if (compact.length >= 8 && /^(?:19|20)\d{2}/.test(compact)) return [compact.slice(0, 4)];

  const numberMatch = emenda.match(/\b0*(\d{1,9})(?:[/.]\d{1,4})?\b/);
  if (!numberMatch) return [];

  const emendaNumber = numberMatch[1].replace(/^0+/, "");
  const description = String(record.descricao || "");
  const sameNumberPattern = new RegExp(`\\b0*${emendaNumber}\\s*/\\s*((?:19|20)\\d{2})\\b`);
  const descriptionMatch = description.match(sameNumberPattern);
  return descriptionMatch ? [descriptionMatch[1]] : [];
}

function resourceYearsForRecord(record) {
  if (record.anoRecurso) return [record.anoRecurso];

  const match = String(record.dataRecurso || "").match(/\b(?:19|20)\d{2}\b/);
  return match ? [match[0]] : [];
}

function allYears() {
  return [...new Set(allRecords.flatMap(amendmentYearsForRecord))]
    .filter(Boolean)
    .sort((a, b) => Number(b) - Number(a));
}

function allResourceYears() {
  return [...new Set(allRecords.flatMap(resourceYearsForRecord))]
    .filter(Boolean)
    .sort((a, b) => Number(b) - Number(a));
}

function isAssociation(record) {
  const beneficiary = normalize(record.beneficiario);
  return /\bassociacao\b|\bassoc\b|assoc\.|\bass\b|ass\./.test(beneficiary);
}

function cleanEntityName(value) {
  return String(value || "")
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "")
    .replace(/\s+-\s+\d[\d.\-/\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+-$/, "");
}

function canonicalBeneficiaryLabel(record) {
  const raw = cleanEntityName(record.beneficiario) || "Não informado";
  const key = normalize(raw);

  if (key.includes("fundacao hospitalar do municipio de varginha") || key.includes("fhomuv")) {
    return "FUNDAÇÃO HOSPITALAR DO MUNICÍPIO DE VARGINHA";
  }
  if (key.includes("hospital regional do sul de minas")) return "HOSPITAL REGIONAL DO SUL DE MINAS";
  if (key.includes("semus") || key.includes("secretaria municipal de saude")) return "SECRETARIA MUNICIPAL DE SAÚDE / SEMUS";
  if (key.includes("fundacao cultural")) return "FUNDAÇÃO CULTURAL DO MUNICÍPIO DE VARGINHA";
  if (key.includes("fuvae") || key.includes("fundacao varginhense de assistencia aos excepcionais")) return "FUVAE";
  if (key.includes("prefeitura do municipio de varginha")) return "PREFEITURA DO MUNICÍPIO DE VARGINHA";
  if (key.includes("policia militar do estado de minas gerais")) return "POLÍCIA MILITAR DO ESTADO DE MINAS GERAIS";

  return raw;
}

function canonicalBeneficiaryKey(record) {
  return normalize(canonicalBeneficiaryLabel(record));
}

function canonicalPartyLabel(record) {
  const raw = String(record.partido || "").trim();
  if (!raw) return "";
  const key = normalize(raw);

  if (key.startsWith("avante")) return "AVANTE";
  if (key.startsWith("mobiliza")) return "MOBILIZA";
  if (key.startsWith("cidadania")) return "CIDADANIA";
  if (key.startsWith("pode") || key.startsWith("podemos")) return "PODEMOS";
  if (key.startsWith("repu")) return "REPUBLICANOS";
  if (key.startsWith("uniao")) return "UNIÃO BRASIL";
  if (key.startsWith("progressis") || key === "pp") return "PP";
  if (key.startsWith("varios")) return "VÁRIOS";
  if (key === "liberal" || key === "pl") return "PL";
  if (key === "pl e prd") return "PL E PRD";
  if (key === "pl outros") return "PL (OUTROS)";
  return raw.toUpperCase();
}

function canonicalPartyKey(record) {
  return normalize(canonicalPartyLabel(record));
}

const PARTY_NOISE_AS_AUTHOR = new Set([
  "podemos",
  "pode",
  "avante",
  "varios",
  "republicanos",
  "uniao",
]);

function canonicalAuthorLabel(record) {
  const raw = String(record.autor || "").trim();
  if (!raw) return "";
  const key = normalize(raw);

  // Autor inválido: nome do partido vazou para o campo autor
  if (PARTY_NOISE_AS_AUTHOR.has(key)) return "";

  // Unifica variantes do mesmo parlamentar (nome curto x nome completo)
  if (key.includes("greyce")) return "GREYCE DE QUEIROZ ELIAS";
  if (key.includes("engler")) return "BRUNO ENGLER";
  if (key.includes("tramonte")) return "MAURO TRAMONTE";
  if (key.includes("noraldino")) return "NORALDINO JÚNIOR";
  if (key.includes("diego") && key.includes("andrade")) return "DIEGO ANDRADE";
  if (key.includes("mario henrique") || key.includes("mário henrique")) return "MÁRIO HENRIQUE CAIXA";

  return raw.toUpperCase();
}

function canonicalAuthorKey(record) {
  return normalize(canonicalAuthorLabel(record));
}

function parliamentaryRole(tipo) {
  if (tipo === "Federal") return "Dep. Federal / Senador";
  if (tipo === "Estadual") return "Dep. Estadual";
  if (tipo === "Municipal") return "Vereador(a)";
  return "Parlamentar";
}

// Mandatos no Senado por MG no período coberto. O ano é o da emenda, não o do pagamento.
const SENATOR_TERMS_MG = {
  "aecio neves": [2011, 2018],
  "antonio anastasia": [2015, 2022],
  "zeze perrella": [2011, 2018],
  "rodrigo pacheco": [2019, 2026],
  "carlos viana": [2019, 2026],
  "cleitinho": [2023, 2026],
};
// Exceções confirmadas em fonte oficial quando a esfera administrativa do
// documento difere do cargo do autor (ex.: resolução estadual que executa recurso federal).
const AUTHOR_ROLE_OVERRIDES = {
  "dimas fabiano": "Dep. Federal",
  "dimas fabiano toledo junior": "Dep. Federal",
  "greyce de queiroz elias": "Dep. Federal",
  "greyce elias": "Dep. Federal",
  "diego andrade": "Dep. Federal",
  "lafayette de andrada": "Dep. Federal",
  "reginaldo lopes": "Dep. Federal",
  "odair cunha": "Dep. Federal",
  "nikolas ferreira": "Dep. Federal",
  "charles evangelista": "Dep. Federal",
};
const AUTOR_INSTITUCIONAL = ["bancada", "relator geral", "com. da saude", "comissao", "sem informacao"];

// Cargo REAL do autor de um registro (Senador ≠ Dep. Federal; coletivos à parte)
function authorRole(record) {
  const a = normalize(record.autor || "");
  if (record.tipo === "Municipal") return "Vereador(a)";
  if (AUTOR_INSTITUCIONAL.some((t) => a.includes(t))) return "Bancada / Comissão / Relator";
  const override = Object.entries(AUTHOR_ROLE_OVERRIDES).find(([name]) => a.includes(name));
  if (override) return override[1];
  if (record.tipo === "Estadual") return "Dep. Estadual";
  const year = Number(amendmentYearsForRecord(record)[0] || 0);
  const senator = Object.entries(SENATOR_TERMS_MG).find(([name, term]) =>
    a.includes(name) && year >= term[0] && year <= term[1]
  );
  return senator ? "Senador(a)" : "Dep. Federal";
}

function uniqueCanonical(labelFn) {
  return [...new Set(allRecords.map(labelFn).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "pt-BR")
  );
}

function groupByLabel(records, labelFn) {
  const map = new Map();
  records.forEach((record) => {
    const label = labelFn(record);
    const key = normalize(label);
    const entry = map.get(key) || { key, label, count: 0, total: 0 };
    entry.count += 1;
    const value = rankingValue(record);
    if (value !== null) entry.total += value;
    map.set(key, entry);
  });
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function uniqueSorted(field) {
  return [...new Set(allRecords.map((record) => record[field]).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));
}

function fillSelect(select, values, displayMap = null) {
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = displayMap ? (displayMap[value] || value) : value;
    select.appendChild(option);
  });
}

function fillDatalist(datalist, values) {
  datalist.innerHTML = "";
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    datalist.appendChild(option);
  });
}

// ---- Resumo "3 esferas": de onde vem o dinheiro ----
function renderEsferas() {
  const box = document.querySelector("#esferasCards");
  if (!box) return;
  const somaTipo = (t) => allRecords
    .filter((r) => r.tipo === t)
    .map((r) => r.stages.recebido)
    .filter((value) => value !== null)
    .reduce((s, value) => s + value, 0);
  const temRecebido = (t) => allRecords.some((r) => r.tipo === t && r.stages.recebido !== null);
  const contaTipo = (t) => allRecords.filter((r) => r.tipo === t).length;
  const esferas = [
    { tipo: "Federal", nome: "Federal", desc: "Dados abertos da CGU", cls: "is-federal",
      total: somaTipo("Federal"), known: temRecebido("Federal"), sub: ((window.EMENDAS_FEDERAIS && window.EMENDAS_FEDERAIS.metadata && window.EMENDAS_FEDERAIS.metadata.emendasUnicas) || "") + " emendas (CGU)" },
    { tipo: "Estadual", nome: "Estadual", desc: "Documentos de execução estadual", cls: "is-estadual",
      total: somaTipo("Estadual"), known: temRecebido("Estadual"), sub: contaTipo("Estadual") + " emendas" },
    { tipo: "Municipal", nome: "Municipal", desc: "Vereadores de Varginha", cls: "is-municipal",
      total: somaTipo("Municipal"), known: temRecebido("Municipal"), sub: contaTipo("Municipal") + " emendas" },
  ];
  box.innerHTML = esferas.map((e) => `
    <button type="button" class="esfera-card ${e.cls}" data-tipo="${e.tipo}">
      <span class="esfera-card__tag">${e.nome}</span>
       <strong class="esfera-card__valor">${e.known ? moneyFormatter.format(e.total) : "N/D"}</strong>
      <span class="esfera-card__sub">${e.sub}</span>
      <span class="esfera-card__desc">${e.desc}</span>
    </button>`).join("");
  box.querySelectorAll(".esfera-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      elements.typeFilter.value = btn.dataset.tipo;
      state.rankRole = "";
      state.quick = "";
      document.querySelectorAll(".chip.active").forEach((c) => c.classList.remove("active"));
      applyFilters();
      document.querySelector(".results-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

// ---- Detalhe federal por tipo (Pix + Finalidade + Bancada + Comissão + Relator) ----
function renderFederalPorTipo() {
  const box = document.querySelector("#federalPorTipo");
  const dados = window.EMENDAS_FEDERAIS && window.EMENDAS_FEDERAIS.resumoTipos;
  if (!box || !dados) return;
  const riscoLabel = { alto: "Vigie de perto", medio: "Acompanhe" };
  const metadata = window.EMENDAS_FEDERAIS.metadata;
  const sourceDate = (metadata.fonteAtualizadaEm || "").slice(0, 10).split("-").reverse().join("/") || "não informada";
  const collectedDate = (metadata.coletadoEm || metadata.extraidoEm || "").slice(0, 10).split("-").reverse().join("/") || "não informada";
  box.innerHTML = `
    <div class="fed-tipos__head">
      <h3>Federal em detalhe — por tipo de emenda</h3>
      <p>Total recebido em repasses federais para favorecidos de Varginha: <strong>${moneyFormatter.format(metadata.totalFederal)}</strong>. ${numberFormatter.format(metadata.emendasUnicas || 0)} emendas únicas e ${numberFormatter.format(metadata.repasses || metadata.registros || 0)} repasses. Fonte atualizada em ${escapeHtml(sourceDate)}; coleta realizada em ${escapeHtml(collectedDate)}.</p>
    </div>
    <div class="fed-tipos__grid">
      ${dados.map((t) => `
        <article class="fed-tipo risco-${t.risco}">
          <div class="fed-tipo__top">
            <span class="fed-tipo__nome">${escapeHtml(t.categoria)}</span>
            <span class="fed-tipo__risco">${riscoLabel[t.risco] || ""}</span>
          </div>
          <strong class="fed-tipo__valor">${moneyFormatter.format(t.total)}</strong>
          <span class="fed-tipo__flag">${t.itemizado ? `✓ ${numberFormatter.format(t.qtdEmendas || t.qtd)} emendas · ${numberFormatter.format(t.qtdRepasses || t.qtd)} repasses` : "resumo — itemização na fonte"}</span>
          <p class="fed-tipo__exp">${escapeHtml(t.explicacao)}</p>
          ${(t.topBeneficiarios && t.topBeneficiarios.length) ? `
            <div class="fed-tipo__ben">
              <span>Maiores beneficiários:</span>
              <ul>${t.topBeneficiarios.slice(0, 4).map((b) =>
                `<li><span>${escapeHtml(b.nome)}</span><em>${moneyFormatter.format(b.valor)}</em></li>`).join("")}</ul>
            </div>` : ""}
          <a class="fed-tipo__fonte" href="${t.fonteUrl}" target="_blank" rel="noopener">Conferir no Portal da Transparência →</a>
        </article>`).join("")}
    </div>
    <p class="fed-tipos__criterio">
      <strong>Critério de qualidade:</strong> contamos apenas emendas destinadas ao poder público e a
      entidades sociais de Varginha. Pagamentos de emendas de outros estados a <em>empresas com sede na
      cidade</em> (ex.: fábricas que venderam equipamentos para outros municípios) não entram — é venda
      comercial, não verba destinada a Varginha.
    </p>`;
}

function setupFilters() {
  fillSelect(elements.typeFilter, uniqueSorted("tipo"), {
    "Federal": "Fonte federal (CGU)",
    "Estadual": "Fonte estadual",
    "Municipal": "Fonte municipal"
  });
  fillSelect(elements.yearFilter, allYears());
  fillSelect(elements.resourceYearFilter, allResourceYears());
  // Anos também nos seletores dos rankings
  ["rankYearAuthor", "rankYearDeputy"].forEach((id) => {
    const sel = document.querySelector("#" + id);
    if (sel) allYears().forEach((y) => {
      const o = document.createElement("option"); o.value = y; o.textContent = y; sel.appendChild(o);
    });
  });
  fillSelect(elements.orgFilter, uniqueSorted("orgao"));

  const uniqueCategories = [...new Set(allRecords.map(r => r.categoria || "Emenda Impositiva Municipal"))].sort();
  fillSelect(elements.categoryFilter, uniqueCategories);
  fillSelect(elements.authorshipFilter, uniqueSorted("autoriaTipo"));
  fillSelect(elements.modalityFilter, uniqueSorted("modalidade"));
  fillSelect(elements.evidenceFilter, uniqueSorted("comprovacao"));

  const uniqueParties = [...new Set(allRecords.map(r => getAuthorMeta(r).party).filter(Boolean))].sort();
  fillSelect(elements.partyFilter, uniqueParties);

  const uniqueAuthors = [...new Set(allRecords.map(r => getAuthorMeta(r).name).filter(Boolean))]
    .filter(name => !isInstitutionalOrGenericAuthor(normalize(name)))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  fillSelect(elements.authorFilter, uniqueAuthors);

  fillDatalist(elements.beneficiaryOptions, uniqueSorted("beneficiario"));
  fillSelect(elements.approvalFilter, uniqueSorted("aprovado"));
  fillSelect(elements.individualFilter, uniqueSorted("emendaIndividual"));

  // Usa a data mais recente entre o payload federal e o municipal
  const federalDate = window.EMENDAS_FEDERAIS?.metadata?.extraidoEm || "";
  const municipalDate = payload.metadata?.geradoEm || "";
  const lastDateStr = [federalDate, municipalDate].filter(Boolean).sort().at(-1) || "";
  const generatedAt = lastDateStr ? new Date(lastDateStr) : null;
  elements.lastUpdate.textContent = generatedAt
    ? generatedAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : "base carregada";
}

function quickMatch(record) {
  if (!state.quick) return true;
  const text = record.textoBusca || normalize(Object.values(record).join(" "));
  if (state.quick === "saude") return text.includes("saude") || text.includes("hospital") || text.includes("semus");
  if (state.quick === "associacoes") return isAssociation(record);
  if (state.quick === "federal") return record.tipo === "Federal";
  if (state.quick === "estadual") return record.tipo === "Estadual";
  if (state.quick === "municipal") return record.tipo === "Municipal";
  if (state.quick === "individual") return record.emendaIndividual === "Sim";
  if (state.quick === "pendente") return normalize(record.aprovado) === "nao";
  if (state.quick === "pendente-com-valor") return normalize(record.aprovado) === "nao" && rankingValue(record) !== null && rankingValue(record) > 0;
  if (state.quick === "pendente-zero") return normalize(record.aprovado) === "nao" && rankingValue(record) === 0;
  if (state.quick === "pendente-sem-data") return normalize(record.aprovado) === "nao" && !record.dataRecurso;
  if (state.quick === "pendente-sem-quem") return normalize(record.aprovado) === "nao" && !record.beneficiario;
  if (state.quick === "alto-valor") return rankingValue(record) !== null && rankingValue(record) >= 100000;
  if (state.quick === "sem-data") return !record.dataRecurso;
  if (state.quick === "valor-zero") return rankingValue(record) === 0;
  if (state.quick === "sem-ano-emenda") return amendmentYearsForRecord(record).length === 0;
  if (state.quick === "sem-ano-recurso") return resourceYearsForRecord(record).length === 0;
  return true;
}

function applyFilters() {
  const search = normalize(elements.searchInput.value);
  const minValue = Number(elements.minValue.value || 0);
  const maxValue = Number(elements.maxValue.value || 0);

  state.filtered = allRecords.filter((record) => {
    const matchesSearch = !search || (record.textoBusca || "").includes(search);
    const matchesType = !elements.typeFilter.value || record.tipo === elements.typeFilter.value;
    const matchesYear = !elements.yearFilter.value || amendmentYearsForRecord(record).includes(elements.yearFilter.value);
    const matchesResourceYear =
      !elements.resourceYearFilter.value || resourceYearsForRecord(record).includes(elements.resourceYearFilter.value);
    const authorMeta = getAuthorMeta(record);
    const matchesOrg = !elements.orgFilter.value || record.orgao === elements.orgFilter.value;
    const matchesParty = !elements.partyFilter.value || authorMeta.party === elements.partyFilter.value;
    const matchesAuthor = !elements.authorFilter.value || authorMeta.name === elements.authorFilter.value;
    const matchesCategory = !elements.categoryFilter.value || (record.categoria || "Emenda Impositiva Municipal") === elements.categoryFilter.value;
    const matchesAuthorship = !elements.authorshipFilter.value || record.autoriaTipo === elements.authorshipFilter.value;
    const matchesModality = !elements.modalityFilter.value || record.modalidade === elements.modalityFilter.value;
    const matchesEvidence = !elements.evidenceFilter.value || record.comprovacao === elements.evidenceFilter.value;
    const matchesStage = !elements.stageFilter.value || record.stages[elements.stageFilter.value] !== null;
    const matchesActive = !elements.activeFilter.value || (
      elements.activeFilter.value === "ativo" ? authorMeta.active : !authorMeta.active
    );
    const beneficiaryTerm = normalize(elements.beneficiaryFilter.value);
    const matchesBeneficiary =
      !beneficiaryTerm ||
      (state.beneficiaryCanonical
        ? canonicalBeneficiaryKey(record) === state.beneficiaryCanonical
        : normalize(record.beneficiario).includes(beneficiaryTerm) || canonicalBeneficiaryKey(record).includes(beneficiaryTerm));
    const matchesApproval = !elements.approvalFilter.value || record.aprovado === elements.approvalFilter.value;
    const matchesIndividual = !elements.individualFilter.value || record.emendaIndividual === elements.individualFilter.value;
    const filterValue = rankingValue(record);
    const matchesMin = !minValue || (filterValue !== null && filterValue >= minValue);
    const matchesMax = !maxValue || (filterValue !== null && filterValue <= maxValue);
    const matchesRankRole = !state.rankRole || authorRole(record) === state.rankRole;
    return (
      matchesSearch &&
      matchesType &&
      matchesYear &&
      matchesResourceYear &&
      matchesOrg &&
      matchesParty &&
      matchesAuthor &&
      matchesCategory &&
      matchesAuthorship &&
      matchesModality &&
      matchesEvidence &&
      matchesStage &&
      matchesActive &&
      matchesBeneficiary &&
      matchesApproval &&
      matchesIndividual &&
      matchesMin &&
      matchesMax &&
      matchesRankRole &&
      quickMatch(record)
    );
  });

  sortRecords();
  state.page = Math.min(state.page, getPageCount());
  state.page = Math.max(state.page, 1);
  render();

  // Sincroniza chips do ranking com tipo + cargo (rankRole)
  const roleToCargo = {
    "Vereador(a)": "Vereador",
    "Dep. Estadual": "DepEstadual",
    "Dep. Federal": "DepFederal",
    "Senador(a)": "Senador",
  };
  const currentCargo = roleToCargo[state.rankRole] || "todos";
  document.querySelectorAll("#authorCargoFilters .rank-chip[data-cargo]").forEach((c) => {
    c.classList.toggle("active", c.dataset.cargo === currentCargo);
  });

  // Sincroniza chips de categoria
  const currentCategory = elements.categoryFilter.value || "todos";
  document.querySelectorAll("#deputyCategoryFilters .rank-chip[data-categoria]").forEach((c) => {
    c.classList.toggle("active", c.dataset.categoria === currentCategory);
  });
}

function sortRecords() {
  const sort = elements.sortFilter.value;
  state.filtered.sort((a, b) => {
    const aValue = rankingValue(a);
    const bValue = rankingValue(b);
    if (sort === "valor-asc") return (aValue ?? Infinity) - (bValue ?? Infinity);
    if (sort === "tipo") return String(a.tipo).localeCompare(String(b.tipo), "pt-BR") || (bValue ?? -Infinity) - (aValue ?? -Infinity);
    if (sort === "beneficiario") return String(a.beneficiario).localeCompare(String(b.beneficiario), "pt-BR");
    if (sort === "ano-desc") return Number(amendmentYearsForRecord(b).at(-1) || 0) - Number(amendmentYearsForRecord(a).at(-1) || 0);
    if (sort === "data-desc") return dateToNumber(b.dataRecurso) - dateToNumber(a.dataRecurso);
    return (bValue ?? -Infinity) - (aValue ?? -Infinity);
  });
}

function getPageCount() {
  return Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
}

function summarize(records) {
  const sumStage = (stage) => {
    const values = records.map((record) => record.stages[stage]).filter((value) => value !== null);
    return { value: values.reduce((sum, value) => sum + value, 0), known: values.length > 0 };
  };
  return { count: records.length, indicado: sumStage("indicado"), empenhado: sumStage("empenhado"), pago: sumStage("pago"), recebido: sumStage("recebido"), executado: sumStage("executado") };
}

function groupBy(records, field) {
  const map = new Map();
  records.forEach((record) => {
    const key = record[field] || "Não informado";
    const entry = map.get(key) || { label: key, count: 0, total: 0 };
    entry.count += 1;
    const value = rankingValue(record);
    if (value !== null) entry.total += value;
    map.set(key, entry);
  });
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function renderMetrics() {
  const summary = summarize(state.filtered);
  const show = (metric) => metric.known ? moneyFormatter.format(metric.value) : "N/D";
  elements.metricCount.textContent = numberFormatter.format(summary.count);
  elements.metricIndicated.textContent = show(summary.indicado);
  elements.metricCommitted.textContent = show(summary.empenhado);
  elements.metricPaid.textContent = show(summary.pago);
  elements.metricReceived.textContent = show(summary.recebido);
  elements.metricExecuted.textContent = show(summary.executado);
  elements.resultSummary.textContent = `${numberFormatter.format(summary.count)} resultado${summary.count === 1 ? "" : "s"} filtrado${summary.count === 1 ? "" : "s"}`;
}

function renderChart(container, groups, options = {}) {
  const max = Math.max(...groups.map((group) => group.total), 1);
  container.innerHTML = groups
    .slice(0, options.limit || 8)
    .map((group) => {
      const width = Math.max(2, Math.round((group.total / max) * 100));
      return `
        <div class="bar-item">
          <div class="bar-row">
            <span class="bar-label" title="${escapeHtml(group.label)}">${escapeHtml(group.label)}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
            <span class="bar-value">${moneyFormatter.format(group.total)} · ${numberFormatter.format(group.count)}</span>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderRecipientRanking() {
  const groups = groupByLabel(state.filtered, canonicalBeneficiaryLabel).slice(0, 10);
  elements.recipientTotal.textContent = `${numberFormatter.format(groups.length)} maiores`;

  if (!groups.length) {
    elements.recipientRanking.innerHTML = `<div class="empty compact-empty">Nenhum beneficiário encontrado.</div>`;
    return;
  }

  elements.recipientRanking.innerHTML = groups
    .map((group, index) => {
      const average = group.count ? group.total / group.count : 0;
      return `
        <button class="ranking-item" data-beneficiary="${escapeHtml(group.label)}" data-beneficiary-key="${escapeHtml(group.key)}" type="button">
          <span class="ranking-position">${index + 1}</span>
          <span class="ranking-name" title="${escapeHtml(group.label)}">${escapeHtml(group.label)}</span>
          <span class="ranking-money">${moneyFormatter.format(group.total)}</span>
          <span class="ranking-meta">${numberFormatter.format(group.count)} emenda${group.count === 1 ? "" : "s"} · média ${moneyFormatter.format(average)}</span>
        </button>
      `;
    })
    .join("");
}

function renderAssociationRanking() {
  const associations = state.filtered.filter(isAssociation);
  const groups = groupByLabel(associations, canonicalBeneficiaryLabel).slice(0, 10);
  elements.associationTotal.textContent = `${numberFormatter.format(groups.length)} associações`;

  if (!groups.length) {
    elements.associationRanking.innerHTML = `<div class="empty compact-empty">Nenhuma associação encontrada com os filtros atuais.</div>`;
    return;
  }

  elements.associationRanking.innerHTML = groups
    .map((group, index) => {
      const average = group.count ? group.total / group.count : 0;
      return `
        <button class="ranking-item association-ranking-item" data-beneficiary="${escapeHtml(group.label)}" data-beneficiary-key="${escapeHtml(group.key)}" type="button">
          <span class="ranking-position">${index + 1}</span>
          <span class="ranking-name" title="${escapeHtml(group.label)}">${escapeHtml(group.label)}</span>
          <span class="ranking-money">${moneyFormatter.format(group.total)}</span>
          <span class="ranking-meta">${numberFormatter.format(group.count)} emenda${group.count === 1 ? "" : "s"} · média ${moneyFormatter.format(average)}</span>
        </button>
      `;
    })
    .join("");
}

function isInstitutionalOrGenericAuthor(key) {
  return key === "sem informacao" || 
         key === "sem registro" || 
         key === "relator geral" || 
         key.includes("comissao") || 
         key.startsWith("com.") || 
         key.includes("bancada");
}

const FEDERAL_MG_PARLIAMENTARIANS = new Set([
  "celia xakriaba",
  "delegada ione",
  "delegado edson moreira",
  "diego andrade",
  "dimas fabiano",
  "dimas fabiano toledo junior",
  "dr frederico",
  "duda salabert",
  "emidinho madeira",
  "eros biondini",
  "gilberto abramo",
  "greyce elias",
  "greyce de queiroz elias",
  "marcelo alvaro antonio",
  "nikolas ferreira",
  "odair cunha",
  "odair jose da cunha",
  "padre joao",
  "patrus ananias",
  "rafael simoes",
  "reginaldo lopes",
  "stefano aguiar",
  "subtenente gonzaga",
  "ze silva"
]);

// Soma reativa exibida abaixo do filtro de ano: total R$ + quantidade dos itens filtrados
function renderRankSum(el, groups) {
  if (!el) return;
  if (!groups.length) {
    el.style.display = "none";
    return;
  }
  const somaValor = groups.reduce((s, g) => s + Number(g.total || 0), 0);
  const somaQtd = groups.reduce((s, g) => s + Number(g.count || 0), 0);
  el.style.display = "flex";
  el.innerHTML =
    `<strong>Soma filtrada:</strong> ${moneyFormatter.format(somaValor)}` +
    ` · ${numberFormatter.format(somaQtd)} emenda${somaQtd === 1 ? "" : "s"}` +
    ` · ${numberFormatter.format(groups.length)} parlamentar${groups.length === 1 ? "" : "es"}`;
}

function renderAuthorRanking() {
  const search = normalize(elements.searchInput.value);
  const rankYear = document.querySelector("#rankYearAuthor")?.value || "";
  const typeFilterVal = elements.typeFilter.value;
  const resourceYearFilterVal = elements.resourceYearFilter.value;
  const orgFilterVal = elements.orgFilter.value;
  const partyFilterVal = elements.partyFilter.value;
  const authorFilterVal = elements.authorFilter.value;
  const categoryFilterVal = elements.categoryFilter.value;
  const activeFilterVal = elements.activeFilter.value;
  const beneficiaryTerm = normalize(elements.beneficiaryFilter.value);
  const approvalFilterVal = elements.approvalFilter.value;
  const individualFilterVal = elements.individualFilter.value;
  const minValue = Number(elements.minValue.value || 0);
  const maxValue = Number(elements.maxValue.value || 0);

  const map = new Map();
  allRecords.forEach((record) => {
    // Painel "Vereadores de Varginha": apenas emendas municipais (vereadores)
    if (record.tipo !== "Municipal") return;
    // Só vereadores da legislatura atual (ativos no cadastro oficial da Câmara).
    // Ex-vereadores que autoraram emendas no passado não aparecem neste painel.
    if (!getAuthorMeta(record).active) return;
    const matchesSearch = !search || (record.textoBusca || "").includes(search);
    const matchesType = !typeFilterVal || record.tipo === typeFilterVal;
    const matchesYear = !rankYear || amendmentYearsForRecord(record).includes(rankYear);
    const matchesResourceYear = !resourceYearFilterVal || resourceYearsForRecord(record).includes(resourceYearFilterVal);
    const authorMeta = getAuthorMeta(record);
    const matchesOrg = !orgFilterVal || record.orgao === orgFilterVal;
    const matchesParty = !partyFilterVal || authorMeta.party === partyFilterVal;
    const matchesAuthor = !authorFilterVal || authorMeta.name === authorFilterVal;
    const matchesCategory = !categoryFilterVal || (record.categoria || "Emenda Impositiva Municipal") === categoryFilterVal;
    const matchesActive = !activeFilterVal || (
      activeFilterVal === "ativo" ? authorMeta.active : !authorMeta.active
    );
    const matchesBeneficiary =
      !beneficiaryTerm ||
      (state.beneficiaryCanonical
        ? canonicalBeneficiaryKey(record) === state.beneficiaryCanonical
        : normalize(record.beneficiario).includes(beneficiaryTerm) || canonicalBeneficiaryKey(record).includes(beneficiaryTerm));
    const matchesApproval = !approvalFilterVal || record.aprovado === approvalFilterVal;
    const matchesIndividual = !individualFilterVal || record.emendaIndividual === individualFilterVal;
    const filterValue = rankingValue(record);
    const matchesMin = !minValue || (filterValue !== null && filterValue >= minValue);
    const matchesMax = !maxValue || (filterValue !== null && filterValue <= maxValue);
    const roleMatches = !state.rankRole || authorRole(record) === state.rankRole;

    if (
      matchesSearch &&
      matchesType &&
      matchesYear &&
      matchesResourceYear &&
      matchesOrg &&
      matchesParty &&
      matchesAuthor &&
      matchesCategory &&
      matchesActive &&
      matchesBeneficiary &&
      matchesApproval &&
      matchesIndividual &&
      matchesMin &&
      matchesMax &&
      roleMatches &&
      quickMatch(record)
    ) {
      // Coautoria: credita cada vereador atual; valor rateado entre os coautores
      // para a soma do painel continuar batendo com o total das emendas.
      const coautores = String(record.autor || "").split(",").map((s) => s.trim()).filter(Boolean);
      const partes = coautores.length || 1;
      coautores.forEach((nomeCoautor) => {
        const meta = getAuthorMeta({ ...record, autor: nomeCoautor });
        if (!meta.active) return; // ex-vereadores não entram neste painel
        const label = meta.name;
        if (!label) return;
        const key = normalize(label);
        if (isInstitutionalOrGenericAuthor(key)) return;

        const entry =
          map.get(key) || { key, label, count: 0, total: 0, tipos: new Map(), partidos: new Set(), active: meta.active, role: authorRole(record) };
        entry.count += 1;
         const value = rankingValue(record);
         if (value !== null) entry.total += value / partes;
        entry.tipos.set(record.tipo, (entry.tipos.get(record.tipo) || 0) + 1);
        if (meta.party) entry.partidos.add(meta.party);
        map.set(key, entry);
      });
    }
  });

  const allGroups = [...map.values()];
  const sortFn = state.authorSort === "quantidade"
    ? (a, b) => b.count - a.count || b.total - a.total
    : (a, b) => b.total - a.total || b.count - a.count;
  const groups = allGroups.slice().sort(sortFn).slice(0, 10);

  elements.authorTotal.textContent = `${numberFormatter.format(map.size)} parlamentares`;
  renderRankSum(elements.authorSum, allGroups);

  if (!groups.length) {
    elements.authorRanking.innerHTML = `<div class="empty compact-empty">Nenhum parlamentar encontrado com os filtros atuais.</div>`;
    return;
  }

  elements.authorRanking.innerHTML = groups
    .map((group, index) => {
      const dominantTipo = [...group.tipos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const role = group.role || parliamentaryRole(dominantTipo);
      const party = [...group.partidos].join(", ");
      const statusText = dominantTipo === "Municipal" ? (group.active ? " · Ativo(a)" : " · Inativo(a)") : "";
      return `
        <button class="ranking-item" data-author="${escapeHtml(group.label)}" type="button">
          <span class="ranking-position">${index + 1}</span>
          <span class="ranking-name" title="${escapeHtml(group.label)}">${escapeHtml(group.label)}</span>
          <span class="ranking-money">${numberFormatter.format(group.count)} emenda${group.count === 1 ? "" : "s"}</span>
          <span class="ranking-meta">${escapeHtml(role)}${party ? ` · ${escapeHtml(party)}` : ""}${statusText} · ${moneyFormatter.format(group.total)}</span>
        </button>
      `;
    })
    .join("");
}

function renderDeputyRanking() {
  const search = normalize(elements.searchInput.value);
  const rankYear = document.querySelector("#rankYearDeputy")?.value || "";
  const typeFilterVal = elements.typeFilter.value;
  const resourceYearFilterVal = elements.resourceYearFilter.value;
  const orgFilterVal = elements.orgFilter.value;
  const partyFilterVal = elements.partyFilter.value;
  const authorFilterVal = elements.authorFilter.value;
  const categoryFilterVal = elements.categoryFilter.value;
  const activeFilterVal = elements.activeFilter.value;
  const beneficiaryTerm = normalize(elements.beneficiaryFilter.value);
  const approvalFilterVal = elements.approvalFilter.value;
  const individualFilterVal = elements.individualFilter.value;
  const minValue = Number(elements.minValue.value || 0);
  const maxValue = Number(elements.maxValue.value || 0);

  const map = new Map();
  allRecords.forEach((record) => {
    if (record.tipo !== "Federal" && record.tipo !== "Estadual") return;

    // Filtro de cargo do painel (chips Dep. Federal / Dep. Estadual / Senador)
    if (state.deputyRole && authorRole(record) !== state.deputyRole) return;

    if (record.tipo === "Federal") {
      const authorMeta = getAuthorMeta(record);
      const key = normalize(authorMeta.name);
      if (authorRole(record) === "Dep. Federal" && !isInstitutionalOrGenericAuthor(key) && !FEDERAL_MG_PARLIAMENTARIANS.has(key)) {
        return;
      }
    }

    const matchesSearch = !search || (record.textoBusca || "").includes(search);
    const matchesType = !typeFilterVal || record.tipo === typeFilterVal;
    const matchesYear = !rankYear || amendmentYearsForRecord(record).includes(rankYear);
    const matchesResourceYear = !resourceYearFilterVal || resourceYearsForRecord(record).includes(resourceYearFilterVal);
    const authorMeta = getAuthorMeta(record);
    const matchesOrg = !orgFilterVal || record.orgao === orgFilterVal;
    const matchesParty = !partyFilterVal || authorMeta.party === partyFilterVal;
    const matchesAuthor = !authorFilterVal || authorMeta.name === authorFilterVal;
    const matchesCategory = !categoryFilterVal || (record.categoria || "Emenda Impositiva Municipal") === categoryFilterVal;
    const matchesActive = !activeFilterVal || (
      activeFilterVal === "ativo" ? authorMeta.active : !authorMeta.active
    );
    const matchesBeneficiary =
      !beneficiaryTerm ||
      (state.beneficiaryCanonical
        ? canonicalBeneficiaryKey(record) === state.beneficiaryCanonical
        : normalize(record.beneficiario).includes(beneficiaryTerm) || canonicalBeneficiaryKey(record).includes(beneficiaryTerm));
    const matchesApproval = !approvalFilterVal || record.aprovado === approvalFilterVal;
    const matchesIndividual = !individualFilterVal || record.emendaIndividual === individualFilterVal;
    const filterValue = rankingValue(record);
    const matchesMin = !minValue || (filterValue !== null && filterValue >= minValue);
    const matchesMax = !maxValue || (filterValue !== null && filterValue <= maxValue);
    const roleMatches = !state.rankRole || authorRole(record) === state.rankRole;

    if (
      matchesSearch &&
      matchesType &&
      matchesYear &&
      matchesResourceYear &&
      matchesOrg &&
      matchesParty &&
      matchesAuthor &&
      matchesCategory &&
      matchesActive &&
      matchesBeneficiary &&
      matchesApproval &&
      matchesIndividual &&
      matchesMin &&
      matchesMax &&
      roleMatches &&
      quickMatch(record)
    ) {
      const label = authorMeta.name;
      if (!label) return;
      const key = normalize(label);
      if (isInstitutionalOrGenericAuthor(key)) return;

      const entry =
        map.get(key) || { key, label, count: 0, total: 0, tipos: new Map(), partidos: new Set(), role: authorRole(record) };
      entry.count += 1;
      const value = rankingValue(record);
      if (value !== null) entry.total += value;
      entry.tipos.set(record.tipo, (entry.tipos.get(record.tipo) || 0) + 1);
      if (authorMeta.party) entry.partidos.add(authorMeta.party);
      map.set(key, entry);
    }
  });

  const allGroups = [...map.values()];
  const sortFn = state.deputySort === "quantidade"
    ? (a, b) => b.count - a.count || b.total - a.total
    : (a, b) => b.total - a.total || b.count - a.count;
  const groups = allGroups.slice().sort(sortFn).slice(0, 10);

  const singular = state.deputyRole === "Senador(a)" ? "senador" : (state.deputyRole ? "deputado" : "parlamentar");
  const plural = singular.endsWith("r") ? singular + "es" : singular + "s";
  elements.deputyTotal.textContent = `${numberFormatter.format(map.size)} ${map.size === 1 ? singular : plural}`;
  renderRankSum(elements.deputySum, allGroups);

  if (!groups.length) {
    elements.deputyRanking.innerHTML = `<div class="empty compact-empty">Nenhum deputado federal ou estadual encontrado com os filtros atuais.</div>`;
    return;
  }

  elements.deputyRanking.innerHTML = groups
    .map((group, index) => {
      const dominantTipo = [...group.tipos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const role = group.role || parliamentaryRole(dominantTipo);
      const party = [...group.partidos].join(", ");
      return `
        <button class="ranking-item" data-author="${escapeHtml(group.label)}" type="button">
          <span class="ranking-position">${index + 1}</span>
          <span class="ranking-name" title="${escapeHtml(group.label)}">${escapeHtml(group.label)}</span>
          <span class="ranking-money">${moneyFormatter.format(group.total)}</span>
          <span class="ranking-meta">${escapeHtml(role)}${party ? ` · ${escapeHtml(party)}` : ""} · ${numberFormatter.format(group.count)} emenda${group.count === 1 ? "" : "s"}</span>
        </button>
      `;
    })
    .join("");
}

function rankingValue(record) {
  return record.stages.executado ?? record.stages.recebido ?? record.stages.pago ?? record.stages.empenhado ?? record.stages.indicado;
}

function renderInstitutionalRanking() {
  const records = state.filtered.filter((record) => record.autoriaTipo !== "Individual");
  const groups = new Map();
  records.forEach((record) => {
    const label = `${record.autoriaTipo}: ${canonicalAuthorLabel(record) || "autoria não identificada"}`;
    const value = rankingValue(record);
    const item = groups.get(label) || { label, count: 0, total: 0, known: 0 };
    item.count += 1;
    if (value !== null) { item.total += value; item.known += 1; }
    groups.set(label, item);
  });
  const ranked = [...groups.values()].sort((a, b) => b.total - a.total || b.count - a.count).slice(0, 10);
  elements.institutionalTotal.textContent = `${numberFormatter.format(groups.size)} autorias`;
  elements.institutionalRanking.innerHTML = ranked.length ? ranked.map((group, index) => `
    <div class="ranking-item" role="listitem">
      <span class="ranking-position">${index + 1}</span>
      <span class="ranking-name">${escapeHtml(group.label)}</span>
      <span class="ranking-money">${group.known ? moneyFormatter.format(group.total) : "N/D"}</span>
      <span class="ranking-meta">${numberFormatter.format(group.count)} registro${group.count === 1 ? "" : "s"} · estágio disponível mais avançado</span>
    </div>`).join("") : `<div class="empty compact-empty">Nenhuma autoria institucional nos filtros atuais.</div>`;
}

function renderTransparencyFlags() {
  const records = state.filtered;
  const flags = [
    {
      label: "Sem data do recurso",
      value: records.filter((record) => !record.dataRecurso).length,
      quick: "sem-data",
    },
    {
      label: "Sem ano da emenda",
      value: records.filter((record) => amendmentYearsForRecord(record).length === 0).length,
      quick: "sem-ano-emenda",
    },
    {
      label: "Sem ano do recurso",
      value: records.filter((record) => resourceYearsForRecord(record).length === 0).length,
      quick: "sem-ano-recurso",
    },
    {
      label: "Valor zerado",
      value: records.filter((record) => rankingValue(record) === 0).length,
      quick: "valor-zero",
    },
    {
      label: "Sem objeto detalhado",
      value: records.filter((record) => !record.objeto && !record.descricao).length,
      search: "",
    },
    {
      label: "Não aprovadas",
      value: records.filter((record) => normalize(record.aprovado) === "nao").length,
      quick: "pendente",
    },
    {
      label: "Sem beneficiário",
      value: records.filter((record) => !record.beneficiario).length,
      search: "",
    },
    {
      label: "Com PDF original",
      value: records.filter((record) => record.arquivoUrl).length,
      positive: true,
    },
  ];

  elements.transparencyFlags.innerHTML = flags
    .map((flag) => {
      const action = flag.quick ? `data-flag-quick="${flag.quick}"` : "";
      const className = flag.positive ? "flag-card positive" : "flag-card";
      const tag = flag.quick ? "button" : "div";
      const type = flag.quick ? 'type="button"' : "";
      return `
        <${tag} class="${className}" ${action} ${type}>
          <strong>${numberFormatter.format(flag.value)}</strong>
          <span>${escapeHtml(flag.label)}</span>
        </${tag}>
      `;
    })
    .join("");
}

function renderNotApprovedSituation() {
  const records = state.filtered.filter((record) => normalize(record.aprovado) === "nao");
  const knownValues = records.map(rankingValue).filter((value) => value !== null);
  const totalValue = knownValues.reduce((sum, value) => sum + value, 0);
  const withValue = records.filter((record) => rankingValue(record) !== null && rankingValue(record) > 0);
  const zeroValue = records.filter((record) => rankingValue(record) === 0);
  const withoutResourceDate = records.filter((record) => !record.dataRecurso);
  const withoutReceiver = records.filter((record) => !record.beneficiario);
  const topValue = knownValues.length ? Math.max(...knownValues) : null;

  elements.notApprovedTotal.textContent = `${numberFormatter.format(records.length)} registros`;

  const cards = [
    {
      label: "Total em não aprovadas",
      value: knownValues.length ? moneyFormatter.format(totalValue) : "N/D",
      helper: `${numberFormatter.format(records.length)} registro${records.length === 1 ? "" : "s"}`,
      quick: "pendente",
    },
    {
      label: "Com valor informado",
      value: numberFormatter.format(withValue.length),
      helper: `somam ${moneyFormatter.format(withValue.reduce((sum, record) => sum + rankingValue(record), 0))}`,
      quick: "pendente-com-valor",
    },
    {
      label: "Valor zerado",
      value: numberFormatter.format(zeroValue.length),
      helper: "precisam de conferência no PDF",
      quick: "pendente-zero",
    },
    {
      label: "Sem data do recurso",
      value: numberFormatter.format(withoutResourceDate.length),
      helper: "não consta disponibilidade do recurso",
      quick: "pendente-sem-data",
    },
    {
      label: "Sem quem recebeu",
      value: numberFormatter.format(withoutReceiver.length),
      helper: "campo do relatório está vazio",
      quick: "pendente-sem-quem",
    },
    {
      label: "Maior não aprovada",
      value: topValue === null ? "N/D" : moneyFormatter.format(topValue),
      helper: "maior valor dentro dos filtros atuais",
      quick: "pendente",
      positive: true,
    },
  ];

  elements.notApprovedSituation.innerHTML = cards
    .map((card) => `
      <button class="situation-card ${card.positive ? "positive" : ""} ${state.quick === card.quick ? "active" : ""}" data-situation-quick="${card.quick}" type="button">
        <strong>${escapeHtml(card.value)}</strong>
        <span>${escapeHtml(card.label)}</span>
        <small>${escapeHtml(card.helper)}</small>
      </button>
    `)
    .join("");
}

function topRecords(records, predicate = () => true, limit = 5) {
  return records
    .filter((record) => predicate(record) && rankingValue(record) !== null && rankingValue(record) > 0)
    .sort((a, b) => rankingValue(b) - rankingValue(a))
    .slice(0, limit);
}

function renderTopValuePanels() {
  const panels = [
    {
      title: "Maiores emendas",
      records: topRecords(state.filtered),
    },
    {
      title: "Maiores não aprovadas",
      records: topRecords(state.filtered, (record) => normalize(record.aprovado) === "nao"),
    },
    {
      title: "Maiores sem data do recurso",
      records: topRecords(state.filtered, (record) => !record.dataRecurso),
    },
    {
      title: "Maiores associações",
      records: topRecords(state.filtered, isAssociation),
    },
  ];

  elements.topValuePanels.innerHTML = panels
    .map((panel) => `
      <section class="top-value-panel">
        <h3>${escapeHtml(panel.title)}</h3>
        ${
          panel.records.length
            ? panel.records
                .map((record) => `
                  <button class="top-value-item" data-id="${record.id}" type="button">
                     <strong>${moneyFormatter.format(rankingValue(record))}</strong>
                    <span>${escapeHtml(canonicalBeneficiaryLabel(record))}</span>
                    <small>${escapeHtml(record.tipo)} · Emenda ${escapeHtml(record.emenda)} · ${escapeHtml(record.aprovado || "situação não informada")}</small>
                  </button>
                `)
                .join("")
            : `<div class="empty compact-empty">Nenhum registro com valor.</div>`
        }
      </section>
    `)
    .join("");
}

function renderInsights() {
  elements.typeTotal.textContent = `${numberFormatter.format(state.filtered.length)} registros`;
  renderChart(elements.typeChart, groupBy(state.filtered, "tipo"), { limit: 5 });
  renderChart(elements.orgChart, groupBy(state.filtered, "orgao"), { limit: 8 });
  renderRecipientRanking();
  renderAssociationRanking();
  renderAuthorRanking();
  renderDeputyRanking();
  renderInstitutionalRanking();
  renderTransparencyFlags();
  renderNotApprovedSituation();
  renderTopValuePanels();
}

function pageRecords() {
  const start = (state.page - 1) * state.pageSize;
  return state.filtered.slice(start, start + state.pageSize);
}

function typeClass(type) {
  return normalize(type).replace(/\s+/g, "-");
}

function renderResults() {
  const pages = getPageCount();
  elements.pageInfo.textContent = `${state.page} de ${pages}`;
  elements.prevPage.disabled = state.page <= 1;
  elements.nextPage.disabled = state.page >= pages;

  if (!state.filtered.length) {
    elements.results.innerHTML = `<div class="empty">Nenhuma emenda encontrada com os filtros atuais.</div>`;
    return;
  }

  elements.results.innerHTML = pageRecords()
    .map((record) => {
      const title = record.beneficiario || "Quem recebeu não informado";
      const object = record.objeto || record.descricao || "Objeto não informado";
      const pdfUrl = fonteOficialUrl(record);
      
      const pdfHintValue = rankingValue(record);
      const pdfHint = `Confira na fonte oficial a emenda ${record.emenda}, o beneficiário e os estágios financeiros${pdfHintValue === null ? "" : `, inclusive ${moneyFormatter.format(pdfHintValue)}`} .`;
      const stageLabels = { indicado: "Indicado", empenhado: "Empenhado", pago: "Pago / transferido", recebido: "Recebido confirmado", executado: "Executado" };
      const valHtml = `<div class="stage-values">${Object.entries(stageLabels).map(([key, label]) => `<span><small>${label}</small><strong>${record.stages[key] === null ? "N/D" : moneyFormatter.format(record.stages[key])}</strong></span>`).join("")}</div>`;

      return `
        <article class="result-card">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(object)}</p>
            <div class="tags">
              <span class="tag ${typeClass(record.tipo)}">Fonte ${escapeHtml(record.tipo)}</span>
              <span class="tag">Autoria: ${escapeHtml(record.autoriaTipo)}</span>
              <span class="tag">Modalidade: ${escapeHtml(record.modalidade)}</span>
              <span class="tag evidence-${typeClass(record.comprovacao)}">${escapeHtml(record.comprovacao)}</span>
              ${record.categoria ? `<span class="tag tag-federal">${escapeHtml(record.categoria)}</span>` : ""}
              <span class="tag">Ano da emenda: ${escapeHtml(amendmentYearsForRecord(record).join(", ") || "Não informado")}</span>
              <span class="tag">Emenda ${escapeHtml(record.emenda)}</span>
              <span class="tag">${escapeHtml(record.statusFinanceiro || record.aprovado || "Situação não informada")}</span>
              <span class="tag">Individual: ${escapeHtml(record.emendaIndividual || "Não informado")}</span>
            </div>
            ${record.execucao ? `<p class="exec-trail"><span>Execução (CGU):</span> ${escapeHtml(record.execucao)}${record.qtdDocumentos ? ` · ${record.qtdDocumentos} documentos` : ""}</p>` : ""}
          </div>
          <div class="value-box">
            ${valHtml}
            <button class="link-button detail-link" data-id="${record.id}" type="button">Ver detalhes</button>
            <a class="link-button" href="${pdfUrl}" target="_blank" rel="noreferrer">Ver na fonte oficial</a>
            <small class="pdf-card-hint">${escapeHtml(pdfHint)}</small>
          </div>
        </article>
      `;
    })
    .join("");
}

function detailItem(label, value) {
  return `
    <div class="detail-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "Não informado")}</strong>
    </div>
  `;
}

function detailUrl(id) {
  const url = new URL(window.location.href);
  url.hash = `emenda=${id}`;
  return url.toString();
}

function openDetails(id, updateUrl = true) {
  const record = allRecords.find((item) => item.id === id);
  if (!record) return;

  state.currentDetailId = id;
  if (updateUrl) history.replaceState(null, "", detailUrl(id));

  elements.detailType.textContent = `${record.tipo} · Emenda ${record.emenda}`;
  elements.detailTitle.textContent = record.beneficiario || "Detalhes da emenda";
  const pdfUrl = fonteOficialUrl(record);
  const sourceCount = record.fontes?.length || 1;
  const authorMeta = getAuthorMeta(record);

  let warningBanner = "";
  if (record.somenteNoBetha) {
    warningBanner = `
      <div class="warning-banner" style="background-color: #fff9db; border-left: 4px solid #fcc419; padding: 12px; margin-bottom: 15px; border-radius: 4px; color: #664d03; font-size: 0.95em; line-height: 1.4;">
        <strong>Pendente na CGU:</strong> Esta emenda foi cadastrada nos sistemas da Prefeitura de Varginha (Betha), mas ainda não possui registro de repasse financeiro pago na base de dados federal (CGU). O valor da CGU é exibido como R$ 0,00 até que o repasse seja oficializado.
      </div>
    `;
  }

  let bethaSection = "";
  if (record.dadosBetha) {
    const db = record.dadosBetha;
    const bethaPdfUrl = db.arquivoUrl ? `./${db.arquivoUrl}` : "";
    bethaSection = `
      <div class="betha-execution-section" style="margin-top: 20px; padding-top: 15px; border-top: 2px dashed #e2e8f0;">
        <h4 style="margin: 0 0 12px 0; color: #1a73e8; font-size: 1.05em; display: flex; align-items: center; gap: 8px;">
          <svg style="width: 20px; height: 20px;" viewBox="0 0 24 24"><path fill="currentColor" d="M12,3L2,12h3v8h6v-6h2v6h6v-8h3L12,3z"/></svg>
          Execução Municipal Relacionada (Prefeitura de Varginha)
        </h4>
        <div class="detail-grid" style="margin-bottom: 12px;">
          ${detailItem("Valor Registrado no Município", db.valorBetha ? moneyFormatter.format(Number(db.valorBetha)) : "Não informado")}
          ${detailItem("Situação / Aprovado", db.aprovado)}
          ${detailItem("Data do Plano", db.dataPlano)}
          ${detailItem("Data Disponibilização", db.dataRecurso)}
          ${detailItem("Prazo Execução", db.prazoExecucao ? `${db.prazoExecucao} meses` : "")}
          ${detailItem("Responsável Local", db.responsavel)}
          ${detailItem("Banco Local", db.banco)}
          ${detailItem("Conta Local", db.conta)}
        </div>
        ${db.objeto ? detailItem("Objeto do Plano de Trabalho", db.objeto) : ""}
        ${bethaPdfUrl ? `
          <p style="margin-top: 12px;">
            <a class="button secondary compact" href="${escapeHtml(bethaPdfUrl)}" target="_blank" rel="noreferrer" style="font-size: 0.9em; padding: 6px 12px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid #1a73e8; color: #1a73e8; background: transparent; border-radius: 4px; text-decoration: none;">
              <svg style="width: 16px; height: 16px;" viewBox="0 0 24 24"><path fill="currentColor" d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/></svg>
              Ver PDF do Plano de Trabalho (Pág. ${db.pagina})
            </a>
          </p>
        ` : ""}
      </div>
    `;
  }

  const confiraValue = record.somenteNoBetha ? (record.dadosBetha?.valorBetha || 0) : record.valor;

  elements.detailBody.innerHTML = `
    ${warningBanner}
    <div class="pdf-guide detail-guide">
      <strong>Como conferir na fonte oficial:</strong>
      abra o portal de transparência da fonte e pesquise pelo número da emenda ${escapeHtml(record.emenda)}, pelo nome de quem recebeu (${escapeHtml(record.beneficiario || "—")}) ou pelo valor ${moneyFormatter.format(Number(confiraValue || 0))} para confirmar os dados.
    </div>
    <div class="detail-grid">
      ${detailItem("Indicado", record.stages.indicado === null ? "N/D" : moneyFormatter.format(record.stages.indicado))}
      ${detailItem("Empenhado", record.stages.empenhado === null ? "N/D" : moneyFormatter.format(record.stages.empenhado))}
      ${detailItem("Pago / transferido", record.stages.pago === null ? "N/D" : moneyFormatter.format(record.stages.pago))}
      ${detailItem("Recebido confirmado", record.stages.recebido === null ? "N/D" : moneyFormatter.format(record.stages.recebido))}
      ${detailItem("Executado", record.stages.executado === null ? "N/D" : moneyFormatter.format(record.stages.executado))}
      ${detailItem("Comprovação", record.comprovacao)}
      ${detailItem("Tipo de autoria", record.autoriaTipo)}
      ${detailItem("Modalidade", record.modalidade)}
      ${detailItem("Ano da emenda", amendmentYearsForRecord(record).join(", "))}
      ${detailItem("Ano do recurso", resourceYearsForRecord(record).join(", "))}
      ${detailItem("Anos relacionados", yearsForRecord(record).join(", ") || record.ano)}
      ${detailItem("Órgão", record.orgao)}
      ${detailItem("Autor", [authorMeta.name, authorMeta.role, authorMeta.party, record.tipo === "Municipal" ? (authorMeta.active ? "Ativo(a)" : "Inativo(a) / Ex-vereador(a)") : ""].filter(Boolean).join(" · "))}
      ${detailItem("Quem recebeu", record.beneficiario)}
      ${detailItem("CNPJ / documento", record.cnpj || record.documentoBeneficiario)}
      ${detailItem("Função", record.funcao)}
      ${detailItem("Data do recurso", record.dataRecurso)}
      ${detailItem("Data do plano", record.dataPlano)}
      ${detailItem("Data do empenho", record.dataEmpenho)}
      ${detailItem("Data do pagamento", record.dataPagamento || record.competenciaPagamento)}
      ${detailItem("Data da execução", record.dataExecucao)}
      ${detailItem("Responsável", record.responsavel)}
      ${detailItem("Prazo de execução", record.prazoExecucao)}
      ${record.tipo === "Federal"
        ? detailItem("Situação financeira", record.statusFinanceiro)
        : detailItem("Aprovado", record.aprovado)}
      ${record.competenciaPagamento ? detailItem("Competência do repasse", record.competenciaPagamento) : ""}
      ${detailItem("Emenda individual", record.emendaIndividual)}
      ${detailItem("Banco", record.banco)}
      ${detailItem("Conta", record.conta)}
    </div>
    ${detailItem("Objeto", record.objeto)}
    ${detailItem("Descrição", record.descricao)}
    ${detailItem("Fonte", record.fonte || record.nomeFonte || record.tipo)}
    ${detailItem("Estágios / observações", record.execucao || record.statusFinanceiro)}
    ${bethaSection}
    <p style="margin-top: 15px;"><a class="button primary" href="${pdfUrl}" target="_blank" rel="noreferrer">Abrir na fonte oficial</a></p>
    <p class="muted">Registro consolidado a partir de ${numberFormatter.format(sourceCount)} ocorrência${sourceCount === 1 ? "" : "s"} nos relatórios oficiais.</p>
  `;

  if (!elements.detailDialog.open) elements.detailDialog.showModal();
}

function closeDetails() {
  elements.detailDialog.close();
}

function openDetailFromHash() {
  const match = window.location.hash.match(/^#emenda=([^&]+)/);
  if (!match) return;
  openDetails(decodeURIComponent(match[1]), false);
}

async function shareCurrentDetail() {
  if (!state.currentDetailId) return;
  const link = detailUrl(state.currentDetailId);
  try {
    await navigator.clipboard.writeText(link);
    elements.shareDetail.textContent = "Link copiado";
  } catch {
    window.prompt("Copie o link da emenda:", link);
  }
  window.setTimeout(() => {
    elements.shareDetail.textContent = "Copiar link";
  }, 1800);
}

function render() {
  renderMetrics();
  renderInsights();
  renderResults();
}

function clearFilters() {
  [
    elements.searchInput,
    elements.typeFilter,
    elements.categoryFilter,
    elements.authorshipFilter,
    elements.modalityFilter,
    elements.evidenceFilter,
    elements.stageFilter,
    elements.activeFilter,
    elements.yearFilter,
    elements.resourceYearFilter,
    elements.orgFilter,
    elements.partyFilter,
    elements.authorFilter,
    elements.beneficiaryFilter,
    elements.approvalFilter,
    elements.individualFilter,
    elements.minValue,
    elements.maxValue,
  ].forEach((element) => {
    element.value = "";
  });

  ["rankYearAuthor", "rankYearDeputy"].forEach((id) => {
    const sel = document.querySelector("#" + id);
    if (sel) sel.value = "";
  });

  elements.sortFilter.value = "valor-desc";
  state.quick = "";
  state.beneficiaryCanonical = "";
  state.page = 1;
  document.querySelectorAll(".chip").forEach((button) => button.classList.remove("active"));

  state.rankRole = "";
  state.deputyRole = "";
  document.querySelectorAll("#authorCargoFilters .rank-chip[data-cargo]").forEach((c) => {
    c.classList.toggle("active", c.dataset.cargo === "todos");
  });
  document.querySelectorAll("#deputyCategoryFilters .rank-chip[data-cargo]").forEach((c) => {
    c.classList.toggle("active", c.dataset.cargo === "todos");
  });
  document.querySelectorAll("#deputyCategoryFilters .rank-chip[data-categoria]").forEach((c) => {
    c.classList.toggle("active", c.dataset.categoria === "todos");
  });

  // Reseta a ordenação dos rankings para o padrão (Valor)
  state.authorSort = "valor";
  state.deputySort = "valor";
  document.querySelectorAll("#authorCargoFilters .rank-chip[data-sort], #deputyCategoryFilters .rank-chip[data-sort]").forEach((c) => {
    c.classList.toggle("active", c.dataset.sort === "valor");
  });

  applyFilters();
}

function exportCsv() {
  const headers = [
    "anosRelacionados",
    "anoDaEmenda",
    "anoDoRecurso",
    "tipo",
    "ano",
    "emenda",
    "autor",
    "partido",
    "valor",
    "beneficiario",
    "orgao",
    "dataRecurso",
    "aprovado",
    "emendaIndividual",
    "objeto",
    "arquivo",
    "pagina",
  ];
  const rows = state.filtered.map((record) =>
    headers
      .map((key) => {
        if (key === "anosRelacionados") return csvValue(yearsForRecord(record).join(", "));
        if (key === "anoDaEmenda") return csvValue(amendmentYearsForRecord(record).join(", "));
        if (key === "anoDoRecurso") return csvValue(resourceYearsForRecord(record).join(", "));
        return csvValue(record[key]);
      })
      .join(";")
  );
  const csv = "\ufeff" + [headers.join(";"), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "emendas-filtradas.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function csvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setupEvents() {
  [
    elements.searchInput,
    elements.typeFilter,
    elements.categoryFilter,
    elements.authorshipFilter,
    elements.modalityFilter,
    elements.evidenceFilter,
    elements.stageFilter,
    elements.activeFilter,
    elements.yearFilter,
    elements.resourceYearFilter,
    elements.orgFilter,
    elements.partyFilter,
    elements.authorFilter,
    elements.beneficiaryFilter,
    elements.approvalFilter,
    elements.individualFilter,
    elements.sortFilter,
    elements.minValue,
    elements.maxValue,
  ].forEach((element) => {
    element.addEventListener("input", () => {
      if (element === elements.beneficiaryFilter) state.beneficiaryCanonical = "";
      if (element === elements.typeFilter) state.rankRole = "";
      state.page = 1;
      applyFilters();
    });
  });

  elements.clearFilters.addEventListener("click", clearFilters);
  elements.exportCsv.addEventListener("click", exportCsv);
  elements.prevPage.addEventListener("click", () => {
    state.page = Math.max(1, state.page - 1);
    renderResults();
  });
  elements.nextPage.addEventListener("click", () => {
    state.page = Math.min(getPageCount(), state.page + 1);
    renderResults();
  });
  elements.results.addEventListener("click", (event) => {
    const button = event.target.closest(".detail-link");
    if (button) openDetails(button.dataset.id);
  });
  elements.recipientRanking.addEventListener("click", (event) => {
    const button = event.target.closest(".ranking-item");
    if (!button) return;
    elements.beneficiaryFilter.value = button.dataset.beneficiary;
    state.beneficiaryCanonical = button.dataset.beneficiaryKey || "";
    state.page = 1;
    applyFilters();
  });
  elements.associationRanking.addEventListener("click", (event) => {
    const button = event.target.closest(".association-ranking-item");
    if (!button) return;
    elements.beneficiaryFilter.value = button.dataset.beneficiary;
    state.beneficiaryCanonical = button.dataset.beneficiaryKey || "";
    state.page = 1;
    applyFilters();
  });
  elements.authorRanking.addEventListener("click", (event) => {
    const button = event.target.closest(".ranking-item");
    if (!button) return;
    elements.authorFilter.value = button.dataset.author;
    state.page = 1;
    applyFilters();
  });
  elements.deputyRanking.addEventListener("click", (event) => {
    const button = event.target.closest(".ranking-item");
    if (!button) return;
    elements.authorFilter.value = button.dataset.author;
    state.page = 1;
    applyFilters();
  });
  elements.transparencyFlags.addEventListener("click", (event) => {
    const button = event.target.closest("[data-flag-quick]");
    if (!button) return;
    state.quick = button.dataset.flagQuick;
    state.page = 1;
    document.querySelectorAll(".chip").forEach((item) => item.classList.toggle("active", item.dataset.quick === state.quick));
    applyFilters();
  });
  elements.notApprovedSituation.addEventListener("click", (event) => {
    const button = event.target.closest("[data-situation-quick]");
    if (!button) return;
    state.quick = button.dataset.situationQuick;
    state.page = 1;
    document.querySelectorAll(".chip").forEach((item) => item.classList.toggle("active", item.dataset.quick === state.quick));
    applyFilters();
  });
  elements.topValuePanels.addEventListener("click", (event) => {
    const button = event.target.closest(".top-value-item");
    if (button) openDetails(button.dataset.id);
  });
  elements.shareDetail.addEventListener("click", shareCurrentDetail);
  elements.closeDialog.addEventListener("click", closeDetails);
  document.querySelectorAll(".chip").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = button.dataset.quick;
      state.quick = state.quick === selected ? "" : selected;
      state.page = 1;
      document.querySelectorAll(".chip").forEach((item) => item.classList.toggle("active", item.dataset.quick === state.quick));
      applyFilters();
    });
  });

  // Chips de cargo: Vereador / Dep. Estadual / Dep. Federal / Senador
  const CARGO_MAP = {
    todos:       { role: "" },
    Vereador:    { role: "Vereador(a)" },
    DepEstadual: { role: "Dep. Estadual" },
    DepFederal:  { role: "Dep. Federal" },
    Senador:     { role: "Senador(a)" },
  };
  document.querySelectorAll("#authorCargoFilters .rank-chip[data-cargo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = CARGO_MAP[btn.dataset.cargo] || CARGO_MAP.todos;
      state.rankRole = m.role;
      state.page = 1;
      applyFilters();
    });
  });

  document.querySelectorAll("#deputyCategoryFilters .rank-chip[data-categoria]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const categoria = btn.dataset.categoria;
      elements.categoryFilter.value = categoria === "todos" ? "" : categoria;
      state.page = 1;
      applyFilters();
    });
  });

  // Chips de cargo do painel Deputados/Senadores (escopo local, não afeta a listagem geral)
  const deputyCargoChips = document.querySelectorAll("#deputyCategoryFilters .rank-chip[data-cargo]");
  deputyCargoChips.forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = CARGO_MAP[btn.dataset.cargo] || CARGO_MAP.todos;
      state.deputyRole = m.role;
      deputyCargoChips.forEach((b) => b.classList.toggle("active", b === btn));
      renderDeputyRanking();
    });
  });

  // Botões de ordenação (Valor / Quantidade) — independentes por painel
  function wireSort(containerId, stateKey, render) {
    const btns = document.querySelectorAll(`#${containerId} .rank-chip[data-sort]`);
    btns.forEach((btn) => {
      btn.addEventListener("click", () => {
        state[stateKey] = btn.dataset.sort === "quantidade" ? "quantidade" : "valor";
        btns.forEach((b) => b.classList.toggle("active", b === btn));
        render();
      });
    });
  }
  wireSort("authorCargoFilters", "authorSort", renderAuthorRanking);
  wireSort("deputyCategoryFilters", "deputySort", renderDeputyRanking);

  // Ano nos rankings — independente do filtro global
  ["rankYearAuthor", "rankYearDeputy"].forEach((id) => {
    const sel = document.querySelector("#" + id);
    if (!sel) return;
    sel.addEventListener("change", () => {
      state.page = 1;
      if (id === "rankYearAuthor") {
        renderAuthorRanking();
      } else {
        renderDeputyRanking();
      }
    });
  });
}

setupFilters();
// Mobile: filtros avançados começam recolhidos (menos rolagem até o conteúdo)
if (window.innerWidth < 700) {
  document.querySelector(".adv-filters")?.removeAttribute("open");
}
renderEsferas();
renderFederalPorTipo();
setupEvents();
applyFilters();
openDetailFromHash();
window.addEventListener("hashchange", openDetailFromHash);
