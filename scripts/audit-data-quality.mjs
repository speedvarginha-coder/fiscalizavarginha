#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const painelDir = path.join(root, "painel-cidadao");
const chunksDir = path.join(painelDir, "data", "chunks");
const manifestPath = path.join(painelDir, "data", "manifest.json");
const outPath = path.join(chunksDir, "auditoria_dados.json");
const strict = process.argv.includes("--strict");

function readJson(name) {
  const filePath = path.join(chunksDir, `${name}.json`);
  if (!fs.existsSync(filePath)) return undefined;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function updateManifest() {
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { gerado_em: new Date().toISOString(), chunks: {} };

  manifest.chunks = manifest.chunks || {};
  const names = fs.readdirSync(chunksDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.basename(name, ".json"))
    .sort();

  for (const name of names) {
    const filePath = path.join(chunksDir, `${name}.json`);
    manifest.chunks[name] = {
      arquivo: `data/chunks/${name}.json`,
      bytes: fs.statSync(filePath).size,
    };
  }

  writeJson(manifestPath, manifest);
}

function parseDate(value) {
  if (!value || typeof value !== "string") return undefined;
  const normalized = value.includes(" ") ? value.replace(" ", "T") : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function daysSince(date) {
  if (!date) return undefined;
  return (Date.now() - date.getTime()) / 86_400_000;
}

function chunkFileDate(name) {
  const filePath = path.join(chunksDir, `${name}.json`);
  if (!fs.existsSync(filePath)) return undefined;
  return fs.statSync(filePath).mtime;
}

function chunkDaysSince(name) {
  return daysSince(chunkFileDate(name));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function cleanPublishedText(value) {
  return String(value ?? "")
    .replace(/ÃƒÂ§/g, "ç")
    .replace(/ÃƒÂ£/g, "ã")
    .replace(/ÃƒÂ¡/g, "á")
    .replace(/ÃƒÂ©/g, "é")
    .replace(/ÃƒÂª/g, "ê")
    .replace(/ÃƒÂ­/g, "í")
    .replace(/ÃƒÂ³/g, "ó")
    .replace(/ÃƒÂ´/g, "ô")
    .replace(/ÃƒÂº/g, "ú")
    .replace(/ÃƒO/g, "ÃO")
    .replace(/ÃƒA/g, "Ã")
    .replace(/Ã‡/g, "Ç")
    .replace(/Ã£/g, "ã")
    .replace(/Ã¡/g, "á")
    .replace(/Ã©/g, "é")
    .replace(/Ãª/g, "ê")
    .replace(/Ã­/g, "í")
    .replace(/Ã³/g, "ó")
    .replace(/Ãº/g, "ú")
    .replace(/Ã§/g, "ç");
}

function meaningfulTokens(value) {
  const stop = new Set([
    "A", "O", "OS", "AS", "DA", "DE", "DO", "DAS", "DOS", "E",
    "LTDA", "ME", "EPP", "SA", "S", "EIRELI", "CIA", "COMERCIO",
    "SERVICOS", "SERVICO", "EMPRESA", "BRASILEIRA", "MUNICIPAL",
    "VARGINHA",
  ]);
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !stop.has(token));
}

// Raiz do CNPJ (8 primeiros dígitos) — visível mesmo com a mascara
// "04.491.116/****-**". Casar por raiz é exato e independe de variação de nome.
function cnpjRoot(value) {
  const digits = String(value || "").split("/")[0].replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : "";
}

function supplierHasContract(supplier, contracts) {
  const root = cnpjRoot(supplier?.cnpj);
  if (root && contracts.some((c) => cnpjRoot(c.cnpj) === root)) return true;

  const name = normalizeText(supplier?.nome);
  const tokens = meaningfulTokens(supplier?.nome);
  if (!name || !tokens.length) return false;

  return contracts.some((contract) => {
    const contracted = normalizeText(contract.contratado || contract.nome || "");
    if (!contracted) return false;
    if (contracted === name || contracted.includes(name) || name.includes(contracted)) return true;
    const contractTokens = new Set(meaningfulTokens(contract.contratado || contract.nome || ""));
    const matches = tokens.filter((token) => contractTokens.has(token)).length;
    return matches >= Math.min(2, tokens.length);
  });
}

// Um pagamento sem contrato vinculado nem sempre e falha: tributos/encargos e
// repasses a entidades (saude/assistencia) ou concessionarias nao passam por
// contrato. Classifica para nao alarmar o cidadao com "R$ X sem contrato"
// quando e repasse SUS legitimo ou recolhimento de imposto.
function gapKind(name) {
  const n = normalizeText(name);
  if (/\b(RECEITA FEDERAL|INSS|SEGURO SOCIAL|PREVIDENCIA|FGTS|PASEP|FAZENDA|TESOURO|IPSEMG|CONTRIBUICAO)\b/.test(n)) return "tributo";
  if (/\b(HOSPITAL|SANTA CASA|MISERICORDIA|UNIMED|CLINICA|FUNDACAO|ASSOCIACAO|INSTITUTO|APAE|NEFRO|RENAIS|CRIANCA|ADOLESCENTE|DESENVOLVIMENTO INTEGRADO|COPASA|CEMIG|SANEAMENTO)\b/.test(n)) return "repasse";
  return "fornecedor";
}

const chunks = {
  atualizado: readJson("atualizado_em"),
  prefeitura: readJson("prefeitura"),
  camaraBetha: readJson("camara_betha"),
  pessoal: readJson("pessoal"),
  pncp: readJson("pncp"),
  cnpjs: readJson("cnpjs"),
  fontesEmendas2026: readJson("fontes_emendas_2026"),
  indice: readJson("indice_relevancia"),
  diario: readJson("diario"),
};

const items = [];

function add(severity, id, title, detail, action, source = "") {
  items.push({
    severity,
    id,
    title: cleanPublishedText(title),
    detail: cleanPublishedText(detail),
    action: cleanPublishedText(action),
    source,
  });
}

const baseDate = parseDate(chunks.atualizado?.iso);
const baseAge = daysSince(baseDate);
if (!baseDate) {
  add("error", "base-sem-data", "Data da coleta principal ausente", "O chunk atualizado_em.json nao tem data ISO valida.", "Rodar a coleta completa antes de publicar.", "atualizado_em.json");
} else if (baseAge > 30) {
  add("error", "base-muito-antiga", "Base principal muito antiga", `Ultima coleta principal ha ${baseAge.toFixed(1)} dias.`, "Rodar npm run data:update e conferir falhas do coletor.", "atualizado_em.json");
} else if (baseAge > 3) {
  add("warning", "base-defasada", "Base principal defasada", `Ultima coleta principal ha ${baseAge.toFixed(1)} dias.`, "Atualizar antes de divulgar dado sensivel ou publicar chamada nas redes.", "atualizado_em.json");
} else {
  add("ok", "base-recente", "Base principal recente", `Ultima coleta principal ha ${Math.max(0, baseAge).toFixed(1)} dias.`, "Manter rotina automatica ativa.", "atualizado_em.json");
}

[
  {
    name: "prefeitura",
    label: "Prefeitura/Betha",
    maxDays: 7,
    action: "Rodar a coleta Betha da Prefeitura antes de divulgar contratos, fornecedores ou pagamentos recentes.",
  },
  {
    name: "camara_betha",
    label: "Camara/Betha",
    maxDays: 7,
    action: "Rodar a coleta Betha da Camara ou conferir manualmente no portal antes de divulgar top fornecedores e contratos.",
  },
  {
    name: "diarias",
    label: "Diarias",
    maxDays: 15,
    action: "Atualizar diarias antes de publicar ranking ou comparativo de viagens.",
  },
].forEach((cfg) => {
  const age = chunkDaysSince(cfg.name);
  if (age === undefined) return;
  if (age > cfg.maxDays) {
    add(
      "warning",
      `chunk-${cfg.name}-defasado`,
      `${cfg.label} com coleta defasada`,
      `Arquivo ${cfg.name}.json foi atualizado ha ${age.toFixed(1)} dias.`,
      cfg.action,
      `${cfg.name}.json`,
    );
  }
});

const fontes2026 = chunks.fontesEmendas2026?.fontes_verificadas || [];
const fontesComErro = fontes2026.filter((fonte) => String(fonte.status || "").toLowerCase() === "erro");
if (fontesComErro.length) {
  add(
    "warning",
    "fonte-emenda-2026-erro",
    "Fonte de emendas 2026 com erro",
    `${fontesComErro.length} fonte(s) retornaram erro. Exemplo: ${fontesComErro[0].nome} - ${fontesComErro[0].resultado}.`,
    "Revisar URL da Camara e, se necessario, substituir por fonte oficial vigente ou LAI.",
    "fontes_emendas_2026.json",
  );
}

if (chunks.fontesEmendas2026?.resumo && chunks.fontesEmendas2026.resumo.lista_estruturada_encontrada === false) {
  add(
    "warning",
    "emendas-2026-sem-lista",
    "Emendas 2026 sem lista consolidada",
    "A investigacao nao localizou lista oficial com numero, vereador, entidade, CNPJ, valor e execucao.",
    "Manter emendas 2026 como dado nao confirmado ate obter planilha oficial ou resposta LAI.",
    "fontes_emendas_2026.json",
  );
}

const pessoalObs = `${chunks.pessoal?.observacao || ""} ${chunks.pessoal?.prefeitura?.status || ""}`;
const pessoalStatusCobertura = `${chunks.pessoal?.prefeitura?.status_cobertura || ""}`;
if (pessoalStatusCobertura !== "preservada_por_cobertura" && /parcial|escopo/i.test(pessoalObs)) {
  add(
    "warning",
    "pessoal-prefeitura-parcial",
    "Pessoal da Prefeitura com escopo parcial",
    "A base indica coleta parcial de Educacao/FUNDEB, nao folha completa da Prefeitura.",
    "Exibir essa limitacao junto dos numeros e buscar consulta completa por competencia.",
    "pessoal.json",
  );
}

const prefeituraServidoresQtd = Array.isArray(chunks.pessoal?.prefeitura?.servidores)
  ? chunks.pessoal.prefeitura.servidores.length
  : null;
if (pessoalStatusCobertura === "preservada_por_cobertura") {
  add(
    "warning",
    "pessoal-prefeitura-preservada",
    "Pessoal da Prefeitura preservado da ultima base completa",
    `A coleta mais recente veio parcial, entao o painel preservou a ultima base completa (${prefeituraServidoresQtd || "sem contagem"} servidores) para nao reduzir a cobertura.`,
    "Conferir a competencia na fonte oficial e tentar nova coleta antes de publicar recorte sobre folha.",
    "pessoal.json",
  );
} else if (Number.isFinite(prefeituraServidoresQtd) && prefeituraServidoresQtd > 0 && prefeituraServidoresQtd < 1000) {
  add(
    "warning",
    "pessoal-prefeitura-cobertura-baixa",
    "Pessoal da Prefeitura com cobertura baixa",
    `A base de pessoal da Prefeitura tem apenas ${prefeituraServidoresQtd} servidor(es), abaixo do esperado para folha completa.`,
    "Preservar a ultima base completa ou corrigir o coletor antes de divulgar numeros de pessoal.",
    "pessoal.json",
  );
}

if (chunks.indice?.anos) {
  const coverages = Object.values(chunks.indice.anos)
    .map((year) => Number(year?.cobertura_pct))
    .filter((n) => Number.isFinite(n));
  const minCoverage = Math.min(...coverages);
  if (Number.isFinite(minCoverage) && minCoverage < 100) {
    add(
      "warning",
      "indice-parcial",
      "Indice parlamentar parcial",
      `A menor cobertura automatica do indice e ${minCoverage}%. Presenca, comissoes e efetividade ainda dependem de fonte confiavel.`,
      "Nao tratar o ranking como definitivo; publicar sempre a cobertura junto da nota.",
      "indice_relevancia.json",
    );
  }
}

if (chunks.pncp?.observacao) {
  add(
    "info",
    "pncp-apoio",
    "PNCP usado como fonte auxiliar",
    "A base PNCP serve para cruzamento e pode nao retornar todos os registros do municipio.",
    "Conferir manualmente no PNCP quando o contrato for sensivel.",
    "pncp.json",
  );
}

const cnpjErrors = Array.isArray(chunks.cnpjs?.erros) ? chunks.cnpjs.erros : [];
if (cnpjErrors.length) {
  add(
    "warning",
    "cnpj-falhas",
    "Falhas de consulta CNPJ",
    `${cnpjErrors.length} CNPJ(s) nao foram enriquecidos na base auxiliar.`,
    "Reprocessar CNPJs antes de usar dados cadastrais em analise publica.",
    "cnpjs.json",
  );
}

const camaraTop = (chunks.camaraBetha?.top_fornecedores_atual || []).slice(0, 20);
// Os maiores pagadores incluem fornecedores da Prefeitura; cruza contra os
// contratos das duas esferas para não acusar "sem contrato" um fornecedor que
// tem contrato na Prefeitura (ex.: a agência VERSAO BR, contrato plurianual).
const camaraContracts = [
  ...(chunks.camaraBetha?.contratos || []),
  ...(chunks.prefeitura?.contratos || []),
];
if (camaraTop.length && camaraContracts.length) {
  const unmatched = camaraTop.filter((supplier) => !supplierHasContract(supplier, camaraContracts));
  const semContrato = unmatched.filter((f) => gapKind(f.nome) === "fornecedor");
  const tributos = unmatched.filter((f) => gapKind(f.nome) === "tributo");
  const repasses = unmatched.filter((f) => gapKind(f.nome) === "repasse");
  if (semContrato.length) {
    const notas = [];
    if (tributos.length) notas.push(`${tributos.length} sao tributos/encargos (ex.: Receita Federal, INSS)`);
    if (repasses.length) notas.push(`${repasses.length} sao repasses a entidades de saude/assistencia ou concessionarias`);
    const cauda = notas.length
      ? ` Os outros ${tributos.length + repasses.length} nao sao falha: ${notas.join("; ")} — nao passam por contrato.`
      : "";
    add(
      "warning",
      "camara-despesa-sem-contrato",
      "Fornecedores sem contrato vinculado automaticamente",
      `${semContrato.length} dos 20 maiores fornecedores de despesas nao bateram com contrato por nome. Exemplos: ${semContrato.slice(0, 4).map((f) => f.nome).join("; ")}.${cauda}`,
      "Cruzar por CNPJ e conferir no Betha — pode ser contrato plurianual ainda nao coletado (a coleta agora resgata contratos vigentes de anos anteriores).",
      "camara_betha.json",
    );
  }
}

// --- NOVOS CHECKS DE QUALIDADE FORENSE ---
const prefeituraTop = (chunks.prefeitura?.top_fornecedores_atual || []).slice(0, 30);
const prefeituraContracts = [
  ...(chunks.prefeitura?.contratos || []),
  ...(chunks.camaraBetha?.contratos || []),
];
if (prefeituraTop.length && prefeituraContracts.length) {
  const unmatched = prefeituraTop.filter((supplier) => !supplierHasContract(supplier, prefeituraContracts));
  const semContrato = unmatched.filter((f) => gapKind(f.nome) === "fornecedor" && Number(f.valor_total || 0) > 1000000);
  if (semContrato.length) {
    add(
      "warning",
      "prefeitura-despesa-sem-contrato",
      "Fornecedores de grande porte sem contrato vinculado automaticamente",
      `${semContrato.length} fornecedor(es) com despesa > R$ 1M nao possuem contrato localizado. Exemplos: ${semContrato.slice(0, 4).map((f) => `${f.nome} (R$ ${(f.valor_total/1000000).toFixed(1)}M)`).join("; ")}.`,
      "Verificar se ha contrato plurianual nao publicado, dispensa/inexigibilidade nao integrada ou repasse SUS/saude nao classificado.",
      "prefeitura.json",
    );
  }
}

const prefeituraContratosTotal = (chunks.prefeitura?.contratos || []).reduce((sum, c) => sum + Number(c.valor || 0), 0);
const prefeituraInexDispTotal = (chunks.prefeitura?.contratos || [])
  .filter((c) => {
    const mod = String(c.modalidade || "").toUpperCase();
    return mod.includes("INEXIG") || mod.includes("DISPENSA");
  })
  .reduce((sum, c) => sum + Number(c.valor || 0), 0);

if (prefeituraContratosTotal > 0) {
  const pctInexDisp = (prefeituraInexDispTotal / prefeituraContratosTotal) * 100;
  if (pctInexDisp > 20) {
    add(
      "warning",
      "prefeitura-contratos-sem-competicao",
      "Alto indice de contratacao sem competicao licitatoria",
      `Contratos por Inexigibilidade ou Dispensa somam ${pctInexDisp.toFixed(1)}% (R$ ${(prefeituraInexDispTotal / 1000000).toFixed(1)}M de R$ ${(prefeituraContratosTotal / 1000000).toFixed(1)}M).`,
      "Auditar as maiores inexigibilidades (ex. IPD, Viacao Real, CNEC) e verificar a regularidade das justificativas de preco.",
      "prefeitura.json",
    );
  }
}

const emendasSemPagamentoAlto = (chunks.prefeitura?.emendas_cruzadas || [])
  .filter((e) => e.status === "sem_pagamento" && Number(e.valor_brl || e.valor || 0) >= 50000);

if (emendasSemPagamentoAlto.length) {
  add(
    "warning",
    "emendas-sem-repasses",
    "Emendas de alto valor sem repasse identificado",
    `${emendasSemPagamentoAlto.length} emenda(s) de R$ 50k+ constam sem pagamento. Exemplos: ${emendasSemPagamentoAlto.slice(0, 3).map((e) => `${e.beneficiario} (R$ ${(Number(e.valor_brl || e.valor)/1000).toFixed(0)}k - ${e.autor})`).join("; ")}.`,
    "Consultar secretaria responsavel se o plano de trabalho foi aprovado ou se ha atraso/impedimento tecnico.",
    "prefeitura.json",
  );
}

const latestDiary = (chunks.diario?.ultimas || [])
  .map((item) => ({ item, date: parseDate(item.data) }))
  .filter((entry) => entry.date)
  .sort((a, b) => b.date - a.date)[0];
const diaryAge = daysSince(latestDiary?.date);
if (latestDiary && diaryAge > 5) {
  add(
    "warning",
    "diario-defasado",
    "Diario Oficial defasado",
    `Ultima edicao registrada: ${latestDiary.item.edicao}, ha ${diaryAge.toFixed(1)} dias.`,
    "Atualizar diario antes de usar o feed de atos recentes.",
    "diario.json",
  );
}

const counts = items.reduce((acc, item) => {
  acc[item.severity] = (acc[item.severity] || 0) + 1;
  return acc;
}, {});

const level = counts.error ? "critical" : counts.warning ? "attention" : "ok";
const payload = {
  gerado_em: new Date().toISOString(),
  level,
  summary: {
    errors: counts.error || 0,
    warnings: counts.warning || 0,
    info: counts.info || 0,
    ok: counts.ok || 0,
    total: items.length,
  },
  atualizado_base: chunks.atualizado || null,
  items,
};

writeJson(outPath, payload);
updateManifest();

const label = level === "critical" ? "CRITICO" : level === "attention" ? "ATENCAO" : "OK";
console.log(`Auditoria de dados: ${label} (${payload.summary.errors} erro(s), ${payload.summary.warnings} aviso(s), ${payload.summary.info} info)`);
for (const item of items.filter((item) => item.severity !== "ok")) {
  console.log(`- [${item.severity}] ${item.title}: ${item.detail}`);
}

if (strict && payload.summary.errors > 0) process.exit(1);
