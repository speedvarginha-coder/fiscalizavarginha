const payload = window.EMENDAS_DATA || { metadata: {}, emendas: [] };
// Emendas federais do Portal da Transparência (CGU), carregadas de data/emendas_federais.js
const federais = (window.EMENDAS_FEDERAIS && window.EMENDAS_FEDERAIS.emendas) || [];
const allRecords = [...(payload.emendas || []), ...federais];

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
  filtered: [...allRecords],
};

const elements = {
  lastUpdate: document.querySelector("#lastUpdate"),
  metricCount: document.querySelector("#metricCount"),
  metricTotal: document.querySelector("#metricTotal"),
  metricBeneficiaries: document.querySelector("#metricBeneficiaries"),
  metricMax: document.querySelector("#metricMax"),
  searchInput: document.querySelector("#searchInput"),
  typeFilter: document.querySelector("#typeFilter"),
  yearFilter: document.querySelector("#yearFilter"),
  resourceYearFilter: document.querySelector("#resourceYearFilter"),
  orgFilter: document.querySelector("#orgFilter"),
  categoryFilter: document.querySelector("#categoryFilter"),
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
  deputyTotal: document.querySelector("#deputyTotal"),
  deputyRanking: document.querySelector("#deputyRanking"),
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

const LOCAL_COUNCILLORS = {
  "zilda silva": { name: "ZILDA SILVA", party: "PP", active: true },
  "zilda maria da silva": { name: "ZILDA SILVA", party: "PP", active: true },
  "alexandre prado": { name: "ALEXANDRE PRADO", party: "AVANTE", active: true },
  "ana rios fontoura": { name: "ANA RIOS", party: "UNIÃO BRASIL", active: true },
  "ana rios": { name: "ANA RIOS", party: "UNIÃO BRASIL", active: true },
  "dandan": { name: "DANDAN", party: "PL", active: true },
  "daniel rodrigues de farias": { name: "DANDAN", party: "PL", active: true },
  "davi martins": { name: "DAVI MARTINS", party: "PL", active: true },
  "rogerio bueno": { name: "ROGÉRIO BUENO", party: "PV", active: true },
  "rogerio bueno machado": { name: "ROGÉRIO BUENO", party: "PV", active: true },
  "joaozinho enfermeiro": { name: "JOÃOZINHO ENFERMEIRO", party: "DC", active: true },
  "joao jamil de oliveira": { name: "JOÃOZINHO ENFERMEIRO", party: "DC", active: true },
  "ze morais": { name: "ZÉ MORAIS", party: "AVANTE", active: true },
  "jose morais neto": { name: "ZÉ MORAIS", party: "AVANTE", active: true },
  "dudu ottoni": { name: "DUDU OTTONI", party: "AVANTE", active: true },
  "eduardo ottoni": { name: "DUDU OTTONI", party: "AVANTE", active: true },
  "bruno leandro coletor": { name: "BRUNO LEANDRO COLETOR", party: "PSDB", active: true },
  "bruno leandro": { name: "BRUNO LEANDRO COLETOR", party: "PSDB", active: true },
  "pastor faustinho": { name: "PASTOR FAUSTINHO", party: "PSD", active: true },
  "faustinho": { name: "PASTOR FAUSTINHO", party: "PSD", active: true },
  "thulyo paiva": { name: "THULYO PAIVA", party: "UNIÃO BRASIL", active: true },
  "thulyo paiva machado": { name: "THULYO PAIVA", party: "UNIÃO BRASIL", active: true },
  "cassio chiodi": { name: "CÁSSIO CHIODI", party: "SOLIDARIEDADE", active: false },
  "miguel da saude": { name: "MIGUEL DA SAÚDE", party: "PSD", active: false },
  "miguel jose de lima": { name: "MIGUEL DA SAÚDE", party: "PSD", active: false },
  "afonso monticeli": { name: "AFONSO MONTICELI", party: "MOBILIZA", active: false },
  "marquinho da cooperativa": { name: "MARQUINHO DA COOPERATIVA", party: "MOBILIZA", active: false },
  "marco antonio": { name: "MARQUINHO DA COOPERATIVA", party: "MOBILIZA", active: false },
  "dr lucas": { name: "DR. LUCAS", party: "PRD", active: false },
  "dr guedes": { name: "DR. GUEDES", party: "PRD", active: false }
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
  let active = true;
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

  return { name, party, active, role };
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
    entry.total += Number(record.valor || 0);
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
  const federalTotal = (window.EMENDAS_FEDERAIS && window.EMENDAS_FEDERAIS.metadata &&
    window.EMENDAS_FEDERAIS.metadata.totalFederal) || 0;
  const somaTipo = (t) => allRecords
    .filter((r) => r.tipo === t)
    .reduce((s, r) => s + Number(r.valor || 0), 0);
  const contaTipo = (t) => allRecords.filter((r) => r.tipo === t).length;
  const esferas = [
    { tipo: "Federal", nome: "Federal", desc: "Deputados e senadores", cls: "is-federal",
      total: federalTotal, sub: ((window.EMENDAS_FEDERAIS && window.EMENDAS_FEDERAIS.metadata && window.EMENDAS_FEDERAIS.metadata.emendasUnicas) || "") + " emendas (CGU)" },
    { tipo: "Estadual", nome: "Estadual", desc: "Deputados estaduais (ALMG)", cls: "is-estadual",
      total: somaTipo("Estadual"), sub: contaTipo("Estadual") + " emendas" },
    { tipo: "Municipal", nome: "Municipal", desc: "Vereadores de Varginha", cls: "is-municipal",
      total: somaTipo("Municipal"), sub: contaTipo("Municipal") + " emendas" },
  ];
  box.innerHTML = esferas.map((e) => `
    <button type="button" class="esfera-card ${e.cls}" data-tipo="${e.tipo}">
      <span class="esfera-card__tag">${e.nome}</span>
      <strong class="esfera-card__valor">${moneyFormatter.format(e.total)}</strong>
      <span class="esfera-card__sub">${e.sub}</span>
      <span class="esfera-card__desc">${e.desc}</span>
    </button>`).join("");
  box.querySelectorAll(".esfera-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      elements.typeFilter.value = btn.dataset.tipo;
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
  box.innerHTML = `
    <div class="fed-tipos__head">
      <h3>Federal em detalhe — por tipo de emenda</h3>
      <p>Total federal para Varginha: <strong>${moneyFormatter.format(window.EMENDAS_FEDERAIS.metadata.totalFederal)}</strong>. Fonte: Portal da Transparência (CGU) · extraído em ${escapeHtml((window.EMENDAS_FEDERAIS.metadata.extraidoEm || "").split("-").reverse().join("/"))}. Cada valor tem link para conferir na fonte oficial.</p>
    </div>
    <div class="fed-tipos__grid">
      ${dados.map((t) => `
        <article class="fed-tipo risco-${t.risco}">
          <div class="fed-tipo__top">
            <span class="fed-tipo__nome">${escapeHtml(t.categoria)}</span>
            <span class="fed-tipo__risco">${riscoLabel[t.risco] || ""}</span>
          </div>
          <strong class="fed-tipo__valor">${moneyFormatter.format(t.total)}</strong>
          <span class="fed-tipo__flag">${t.itemizado ? "✓ " + t.qtd + " emendas itemizadas na lista" : "resumo — itemização na fonte"}</span>
          <p class="fed-tipo__exp">${escapeHtml(t.explicacao)}</p>
          ${(t.topBeneficiarios && t.topBeneficiarios.length) ? `
            <div class="fed-tipo__ben">
              <span>Maiores beneficiários:</span>
              <ul>${t.topBeneficiarios.slice(0, 4).map((b) =>
                `<li><span>${escapeHtml(b.nome)}</span><em>${moneyFormatter.format(b.valor)}</em></li>`).join("")}</ul>
            </div>` : ""}
          <a class="fed-tipo__fonte" href="${t.fonteUrl}" target="_blank" rel="noopener">Conferir no Portal da Transparência →</a>
        </article>`).join("")}
    </div>`;
}

function setupFilters() {
  fillSelect(elements.typeFilter, uniqueSorted("tipo"), {
    "Federal": "Deputado Federal / Senador",
    "Estadual": "Deputado Estadual",
    "Municipal": "Vereador(a)"
  });
  fillSelect(elements.yearFilter, allYears());
  fillSelect(elements.resourceYearFilter, allResourceYears());
  fillSelect(elements.orgFilter, uniqueSorted("orgao"));

  const uniqueCategories = [...new Set(allRecords.map(r => r.categoria || "Emenda Impositiva Municipal"))].sort();
  fillSelect(elements.categoryFilter, uniqueCategories);

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
  if (state.quick === "pendente-com-valor") return normalize(record.aprovado) === "nao" && Number(record.valor || 0) > 0;
  if (state.quick === "pendente-zero") return normalize(record.aprovado) === "nao" && Number(record.valor || 0) === 0;
  if (state.quick === "pendente-sem-data") return normalize(record.aprovado) === "nao" && !record.dataRecurso;
  if (state.quick === "pendente-sem-quem") return normalize(record.aprovado) === "nao" && !record.beneficiario;
  if (state.quick === "alto-valor") return Number(record.valor || 0) >= 100000;
  if (state.quick === "sem-data") return !record.dataRecurso;
  if (state.quick === "valor-zero") return Number(record.valor || 0) === 0;
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
    const matchesMin = Number(record.valor || 0) >= minValue;
    const matchesMax = !maxValue || Number(record.valor || 0) <= maxValue;
    return (
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
      quickMatch(record)
    );
  });

  sortRecords();
  state.page = Math.min(state.page, getPageCount());
  state.page = Math.max(state.page, 1);
  render();
}

function sortRecords() {
  const sort = elements.sortFilter.value;
  state.filtered.sort((a, b) => {
    if (sort === "valor-asc") return Number(a.valor || 0) - Number(b.valor || 0);
    if (sort === "tipo") return String(a.tipo).localeCompare(String(b.tipo), "pt-BR") || Number(b.valor || 0) - Number(a.valor || 0);
    if (sort === "beneficiario") return String(a.beneficiario).localeCompare(String(b.beneficiario), "pt-BR");
    if (sort === "ano-desc") return Number(amendmentYearsForRecord(b).at(-1) || 0) - Number(amendmentYearsForRecord(a).at(-1) || 0);
    if (sort === "data-desc") return dateToNumber(b.dataRecurso) - dateToNumber(a.dataRecurso);
    return Number(b.valor || 0) - Number(a.valor || 0);
  });
}

function getPageCount() {
  return Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
}

function summarize(records) {
  const total = records.reduce((sum, record) => sum + Number(record.valor || 0), 0);
  const beneficiaries = new Set(records.map(canonicalBeneficiaryKey).filter(Boolean)).size;
  const max = records.reduce((highest, record) => Math.max(highest, Number(record.valor || 0)), 0);
  return { count: records.length, total, beneficiaries, max };
}

function groupBy(records, field) {
  const map = new Map();
  records.forEach((record) => {
    const key = record[field] || "Não informado";
    const entry = map.get(key) || { label: key, count: 0, total: 0 };
    entry.count += 1;
    entry.total += Number(record.valor || 0);
    map.set(key, entry);
  });
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function renderMetrics() {
  const summary = summarize(state.filtered);
  elements.metricCount.textContent = numberFormatter.format(summary.count);
  elements.metricTotal.textContent = moneyFormatter.format(summary.total);
  elements.metricBeneficiaries.textContent = numberFormatter.format(summary.beneficiaries);
  elements.metricMax.textContent = moneyFormatter.format(summary.max);
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

function renderAuthorRanking() {
  const map = new Map();
  state.filtered.forEach((record) => {
    const authorMeta = getAuthorMeta(record);
    const label = authorMeta.name;
    if (!label) return;
    const key = normalize(label);
    if (isInstitutionalOrGenericAuthor(key)) return;
    const entry =
      map.get(key) || { key, label, count: 0, total: 0, tipos: new Map(), partidos: new Set(), active: authorMeta.active };
    entry.count += 1;
    entry.total += Number(record.valor || 0);
    entry.tipos.set(record.tipo, (entry.tipos.get(record.tipo) || 0) + 1);
    if (authorMeta.party) entry.partidos.add(authorMeta.party);
    map.set(key, entry);
  });

  const groups = [...map.values()]
    .sort((a, b) => b.count - a.count || b.total - a.total)
    .slice(0, 10);

  elements.authorTotal.textContent = `${numberFormatter.format(map.size)} parlamentares`;

  if (!groups.length) {
    elements.authorRanking.innerHTML = `<div class="empty compact-empty">Nenhum parlamentar encontrado com os filtros atuais.</div>`;
    return;
  }

  elements.authorRanking.innerHTML = groups
    .map((group, index) => {
      const dominantTipo = [...group.tipos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const role = parliamentaryRole(dominantTipo);
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
  const map = new Map();
  state.filtered.forEach((record) => {
    if (record.tipo !== "Federal" && record.tipo !== "Estadual") return;
    const authorMeta = getAuthorMeta(record);
    const label = authorMeta.name;
    if (!label) return;
    const key = normalize(label);
    if (isInstitutionalOrGenericAuthor(key)) return;
    const entry =
      map.get(key) || { key, label, count: 0, total: 0, tipos: new Map(), partidos: new Set() };
    entry.count += 1;
    entry.total += Number(record.valor || 0);
    entry.tipos.set(record.tipo, (entry.tipos.get(record.tipo) || 0) + 1);
    if (authorMeta.party) entry.partidos.add(authorMeta.party);
    map.set(key, entry);
  });

  const groups = [...map.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  elements.deputyTotal.textContent = `${numberFormatter.format(map.size)} deputados`;

  if (!groups.length) {
    elements.deputyRanking.innerHTML = `<div class="empty compact-empty">Nenhum deputado federal ou estadual encontrado com os filtros atuais.</div>`;
    return;
  }

  elements.deputyRanking.innerHTML = groups
    .map((group, index) => {
      const dominantTipo = [...group.tipos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const role = parliamentaryRole(dominantTipo);
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
      value: records.filter((record) => Number(record.valor || 0) === 0).length,
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
  const totalValue = records.reduce((sum, record) => sum + Number(record.valor || 0), 0);
  const withValue = records.filter((record) => Number(record.valor || 0) > 0);
  const zeroValue = records.filter((record) => Number(record.valor || 0) === 0);
  const withoutResourceDate = records.filter((record) => !record.dataRecurso);
  const withoutReceiver = records.filter((record) => !record.beneficiario);
  const topValue = records.reduce((max, record) => Math.max(max, Number(record.valor || 0)), 0);

  elements.notApprovedTotal.textContent = `${numberFormatter.format(records.length)} registros`;

  const cards = [
    {
      label: "Total em não aprovadas",
      value: moneyFormatter.format(totalValue),
      helper: `${numberFormatter.format(records.length)} registro${records.length === 1 ? "" : "s"}`,
      quick: "pendente",
    },
    {
      label: "Com valor informado",
      value: numberFormatter.format(withValue.length),
      helper: `somam ${moneyFormatter.format(withValue.reduce((sum, record) => sum + Number(record.valor || 0), 0))}`,
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
      value: moneyFormatter.format(topValue),
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
    .filter((record) => predicate(record) && Number(record.valor || 0) > 0)
    .sort((a, b) => Number(b.valor || 0) - Number(a.valor || 0))
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
                    <strong>${moneyFormatter.format(Number(record.valor || 0))}</strong>
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
      const pdfHint = `Confira na fonte oficial a emenda ${record.emenda}, quem recebeu e o valor ${moneyFormatter.format(Number(record.valor || 0))}.`;
      return `
        <article class="result-card">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(object)}</p>
            <div class="tags">
              <span class="tag ${typeClass(record.tipo)}">${escapeHtml(record.tipo)}</span>
              ${record.categoria ? `<span class="tag tag-federal">${escapeHtml(record.categoria)}</span>` : ""}
              <span class="tag">Ano da emenda: ${escapeHtml(amendmentYearsForRecord(record).join(", ") || "Não informado")}</span>
              <span class="tag">Emenda ${escapeHtml(record.emenda)}</span>
              <span class="tag">${escapeHtml(record.aprovado || "Aprovação não informada")}</span>
              <span class="tag">Individual: ${escapeHtml(record.emendaIndividual || "Não informado")}</span>
            </div>
            ${record.execucao ? `<p class="exec-trail"><span>Execução (CGU):</span> ${escapeHtml(record.execucao)}${record.qtdDocumentos ? ` · ${record.qtdDocumentos} documentos` : ""}</p>` : ""}
          </div>
          <div class="value-box">
            <strong>${moneyFormatter.format(Number(record.valor || 0))}</strong>
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
  elements.detailBody.innerHTML = `
    <div class="pdf-guide detail-guide">
      <strong>Como conferir na fonte oficial:</strong>
      abra o portal de transparência da fonte e pesquise pelo número da emenda ${escapeHtml(record.emenda)}, pelo nome de quem recebeu (${escapeHtml(record.beneficiario || "—")}) ou pelo valor ${moneyFormatter.format(Number(record.valor || 0))} para confirmar os dados.
    </div>
    <div class="detail-grid">
      ${detailItem("Valor", moneyFormatter.format(Number(record.valor || 0)))}
      ${detailItem("Ano da emenda", amendmentYearsForRecord(record).join(", "))}
      ${detailItem("Ano do recurso", resourceYearsForRecord(record).join(", "))}
      ${detailItem("Anos relacionados", yearsForRecord(record).join(", ") || record.ano)}
      ${detailItem("Órgão", record.orgao)}
      ${detailItem("Autor", [authorMeta.name, authorMeta.party, record.tipo === "Municipal" ? (authorMeta.active ? "Ativo(a)" : "Inativo(a) / Ex-vereador(a)") : ""].filter(Boolean).join(" · "))}
      ${detailItem("Quem recebeu", record.beneficiario)}
      ${detailItem("Documento", record.documentoBeneficiario)}
      ${detailItem("Função", record.funcao)}
      ${detailItem("Data do recurso", record.dataRecurso)}
      ${detailItem("Data do plano", record.dataPlano)}
      ${detailItem("Responsável", record.responsavel)}
      ${detailItem("Prazo de execução", record.prazoExecucao)}
      ${detailItem("Aprovado", record.aprovado)}
      ${detailItem("Emenda individual", record.emendaIndividual)}
      ${detailItem("Banco", record.banco)}
      ${detailItem("Conta", record.conta)}
    </div>
    ${detailItem("Objeto", record.objeto)}
    ${detailItem("Descrição", record.descricao)}
    <p><a class="button primary" href="${pdfUrl}" target="_blank" rel="noreferrer">Abrir na fonte oficial</a></p>
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
  elements.sortFilter.value = "valor-desc";
  state.quick = "";
  state.beneficiaryCanonical = "";
  state.page = 1;
  document.querySelectorAll(".chip").forEach((button) => button.classList.remove("active"));
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
}

setupFilters();
renderEsferas();
renderFederalPorTipo();
setupEvents();
applyFilters();
openDetailFromHash();
window.addEventListener("hashchange", openDetailFromHash);
