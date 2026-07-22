#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const painelDir = path.join(root, "painel-cidadao");
const dataDir = path.join(painelDir, "data");
const chunksDir = path.join(dataDir, "chunks");
const snapshotsDir = path.join(dataDir, "snapshots");
const manifestPath = path.join(dataDir, "manifest.json");
const outChunkPath = path.join(chunksDir, "mudancas_coleta.json");
const previousChunksDir = process.env.FISCALIZA_PREVIOUS_CHUNKS || "";

const SNAPSHOT_LIMIT = 30;
const MONEY_EPSILON = 1;
const RELEVANT_SUPPLIER_MIN = 100_000;

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = JSON.stringify(value, null, 2) + "\n";
  const retryableCodes = new Set(["EBUSY", "EPERM", "EACCES", "UNKNOWN"]);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.writeFileSync(filePath, content, "utf8");
      return;
    } catch (error) {
      if (!retryableCodes.has(error?.code) || attempt === 7) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 125 * (attempt + 1));
    }
  }
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function norm(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hash(value, size = 12) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, size);
}

function cnpjRoot(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isoDate(value) {
  return String(value || "").slice(0, 10);
}

function snapshotIdFromIso(iso) {
  const base = iso && !Number.isNaN(new Date(iso).getTime()) ? iso : new Date().toISOString();
  return base.replace(/[:.]/g, "-");
}

function snapshotFingerprint({ contratos, fornecedores, diario, issues, asfalto, obras }) {
  return hash(JSON.stringify({
    contratos: contratos.map((item) => [item.id, item.valor_brl, item.objeto_hash]),
    obras: obras.map((item) => [item.id, item.valor_brl, item.objeto_hash, item.percentual_executado]),
    fornecedores: fornecedores.map((item) => [item.id, item.rank, item.valor_brl]),
    diario: diario.map((item) => [item.id, item.data, item.extra]),
    pendencias: issues.map((item) => [item.id, item.severity, item.detail]),
    asfalto: asfalto.map((item) => [item.id, item.valor_brl]),
  }), 8);
}

function contractId(item, orgao) {
  const numeroRaw = cleanText(item.numero || "");
  const anoRaw = cleanText(item.ano || "");
  const numero = numeroRaw && numeroRaw !== "0" ? numeroRaw : "";
  const ano = anoRaw && anoRaw !== "0" ? anoRaw : "";
  const rootCnpj = cnpjRoot(item.cnpj);
  const fornecedor = norm(item.contratado || item.fornecedor || "").slice(0, 40);
  const fallback = hash([item.contratado, item.fornecedor, item.objeto, item.data_assinatura, item.valor].join("|"));
  if (numero || ano) return `${orgao}:${ano || "sem-ano"}:${numero || "sem-numero"}:${rootCnpj || fornecedor || fallback}`;
  return `${orgao}:sem-numero:${rootCnpj || fornecedor || "sem-fornecedor"}:${fallback}`;
}

function topFornecedorId(item, orgao) {
  const rootCnpj = cnpjRoot(item.cnpj);
  return `${orgao}:${rootCnpj || norm(item.nome).slice(0, 48)}`;
}

function diaryId(item) {
  const edicao = cleanText(item.edicao || item.numero || "");
  const data = isoDate(item.data);
  const ano = cleanText(item.ano || data.slice(0, 4));
  return `diario:${ano}:${edicao || hash(data + cleanText(item.url_pdf || ""))}`;
}

function contractToSnapshot(item, orgao) {
  const value = number(item.valor);
  const numero = cleanText(item.numero || "");
  const ano = cleanText(item.ano || "");
  const fornecedor = cleanText(item.contratado || item.fornecedor || "");
  const objeto = cleanText(item.objeto || item.descricao || "");
  return {
    id: contractId(item, orgao),
    orgao,
    numero,
    ano,
    fornecedor,
    cnpj_raiz: cnpjRoot(item.cnpj),
    data: isoDate(item.data_assinatura || item.data || ""),
    valor_brl: value,
    modalidade: cleanText(item.modalidade || ""),
    objeto,
    objeto_hash: hash(objeto),
  };
}

function publicWorkId(item) {
  const idObra = cleanText(item.id_obra || item.numero || "");
  const matricula = cleanText(item.matricula_obra || "");
  const fallback = hash([item.objeto, item.data_inicio, item.valor, item.endereco].join("|"));
  return `Prefeitura:obra:${idObra || matricula || fallback}`;
}

function publicWorkToSnapshot(item) {
  const objeto = cleanText(item.objeto || "");
  return {
    id: publicWorkId(item),
    orgao: "Prefeitura",
    numero: cleanText(item.numero || item.id_obra || ""),
    ano: cleanText(item.ano || isoDate(item.data_inicio).slice(0, 4)),
    fornecedor: cleanText(item.fornecedor || item.contratado || ""),
    data: isoDate(item.data_inicio || item.data_ordem_servico || item.data_ultima_medicao || ""),
    valor_brl: number(item.valor || item.valor_efetivo || item.valor_atualizado || item.valor_previsto || 0),
    objeto,
    objeto_hash: hash(objeto),
    categoria: cleanText(item.categoria || ""),
    tipo_obra: cleanText(item.tipo_obra || ""),
    situacao: cleanText(item.situacao || ""),
    percentual_executado: number(item.percentual_executado || 0),
    endereco: cleanText(item.endereco || ""),
    source: "Obras Publicas Betha 83026",
  };
}

function dedupeContracts(items) {
  const map = new Map();
  for (const item of items) {
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, { ...item });
      continue;
    }
    prev.valor_brl += item.valor_brl;
    if (!prev.objeto && item.objeto) prev.objeto = item.objeto;
    if (!prev.data && item.data) prev.data = item.data;
    if (!prev.fornecedor && item.fornecedor) prev.fornecedor = item.fornecedor;
    prev.objeto_hash = hash([prev.objeto_hash, item.objeto_hash].join("|"));
  }
  return Array.from(map.values());
}

function supplierToSnapshot(item, orgao, rank) {
  return {
    id: topFornecedorId(item, orgao),
    orgao,
    rank,
    nome: cleanText(item.nome || ""),
    cnpj_raiz: cnpjRoot(item.cnpj),
    valor_brl: number(item.valor_total || item.valor || 0),
  };
}

function diaryToSnapshot(item) {
  const data = isoDate(item.data);
  return {
    id: diaryId(item),
    edicao: cleanText(item.edicao || item.numero || ""),
    ano: cleanText(item.ano || data.slice(0, 4)),
    data,
    extra: Boolean(item.extra),
    titulo: `Diario Oficial - Edicao ${cleanText(item.edicao || item.numero || "") || "sem numero"}`,
    url: cleanText(item.url_pdf || item.url_leitor || item.url || ""),
  };
}

const ASPHALT_TERMS = [
  "asfalto",
  "asfaltica",
  "asfaltico",
  "cbuq",
  "massa asfaltica",
  "tapa buraco",
  "tapa-buraco",
  "recape",
  "pavimentacao",
  "pavimenta",
  "buraco",
];

function isAsphaltContract(contract) {
  const text = norm([contract.objeto, contract.fornecedor, contract.modalidade, contract.categoria, contract.tipo_obra].join(" "));
  return ASPHALT_TERMS.some((term) => text.includes(norm(term)));
}

function issueToSnapshot(issue) {
  const id = cleanText(issue.id || `${issue.severity || "info"}:${issue.title || issue.detail || hash(JSON.stringify(issue))}`);
  return {
    id,
    severity: cleanText(issue.severity || "info"),
    title: cleanText(issue.title || "Pendencia de dado"),
    detail: cleanText(issue.detail || ""),
    action: cleanText(issue.action || ""),
    source: cleanText(issue.source || ""),
  };
}

function loadChunksFrom(dir) {
  return {
    atualizado: readJson(path.join(dir, "atualizado_em.json"), {}),
    prefeitura: readJson(path.join(dir, "prefeitura.json"), {}),
    camaraBetha: readJson(path.join(dir, "camara_betha.json"), {}),
    diario: readJson(path.join(dir, "diario.json"), {}),
    auditoria: readJson(path.join(dir, "auditoria_dados.json"), {}),
  };
}

function buildSnapshotFromChunks(dir, source = "chunks") {
  const chunks = loadChunksFrom(dir);
  const coletaIso = cleanText(chunks.atualizado?.iso || chunks.prefeitura?.atualizado_em || chunks.camaraBetha?.atualizado_em || new Date().toISOString());
  const prefeituraContratos = (chunks.prefeitura?.contratos || []).map((item) => contractToSnapshot(item, "Prefeitura"));
  const camaraContratos = (chunks.camaraBetha?.contratos || []).map((item) => contractToSnapshot(item, "Camara"));
  const contratos = dedupeContracts([...prefeituraContratos, ...camaraContratos]);
  const obras = (chunks.prefeitura?.obras_publicas || []).map(publicWorkToSnapshot);
  const fornecedores = [
    ...(chunks.prefeitura?.top_fornecedores_atual || []).map((item, idx) => supplierToSnapshot(item, "Prefeitura", idx + 1)),
    ...(chunks.camaraBetha?.top_fornecedores_atual || []).map((item, idx) => supplierToSnapshot(item, "Camara", idx + 1)),
  ];
  const diario = (chunks.diario?.ultimas || []).map(diaryToSnapshot);
  const issues = (chunks.auditoria?.issues || chunks.auditoria?.items || [])
    .filter((issue) => issue && issue.severity !== "ok")
    .map(issueToSnapshot);
  const asfalto = [
    ...contratos.filter(isAsphaltContract),
    ...obras.filter(isAsphaltContract),
  ].map((item) => ({
    id: item.id,
    orgao: item.orgao,
    numero: item.numero,
    ano: item.ano,
    fornecedor: item.fornecedor,
    data: item.data,
    valor_brl: item.valor_brl,
    objeto: item.objeto,
    source: item.source || "Contrato/Licitacao",
  }));
  const id = `${snapshotIdFromIso(coletaIso)}-${snapshotFingerprint({ contratos, fornecedores, diario, issues, asfalto, obras })}`;

  return {
    schema_version: 1,
    snapshot_id: id,
    source,
    gerado_em: new Date().toISOString(),
    coleta_iso: coletaIso,
    data_humana: cleanText(chunks.atualizado?.data_humana || ""),
    totais: {
      contratos_qtd: contratos.length,
      contratos_valor_brl: contratos.reduce((sum, item) => sum + item.valor_brl, 0),
      obras_publicas_qtd: obras.length,
      obras_publicas_valor_brl: obras.reduce((sum, item) => sum + item.valor_brl, 0),
      fornecedores_qtd: fornecedores.length,
      diario_edicoes_qtd: diario.length,
      pendencias_qtd: issues.length,
      asfalto_qtd: asfalto.length,
      asfalto_valor_brl: asfalto.reduce((sum, item) => sum + item.valor_brl, 0),
    },
    contratos,
    obras_publicas: obras,
    fornecedores,
    diario,
    pendencias: issues,
    asfalto,
  };
}

function latestPublicSnapshot(excludeId) {
  if (!fs.existsSync(snapshotsDir)) return null;
  const files = fs.readdirSync(snapshotsDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse();
  for (const name of files) {
    const full = path.join(snapshotsDir, name);
    const parsed = readJson(full);
    if (parsed && parsed.snapshot_id !== excludeId) {
      parsed._public_path = `data/snapshots/${name}`;
      return parsed;
    }
  }
  return null;
}

function mapById(items) {
  return new Map((items || []).map((item) => [item.id, item]));
}

function fmtBRL(value) {
  return number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function itemLinkId(contract) {
  return `${contract.orgao.toUpperCase()}-${contract.ano || ""}-${contract.numero || "?"}`;
}

function diffSnapshots(current, previous) {
  const items = [];
  const curContracts = mapById(current.contratos);
  const prevContracts = mapById(previous?.contratos);
  const curSuppliers = mapById(current.fornecedores);
  const prevSuppliers = mapById(previous?.fornecedores);
  const curDiary = mapById(current.diario);
  const prevDiary = mapById(previous?.diario);
  const curIssues = mapById(current.pendencias);
  const prevIssues = mapById(previous?.pendencias);
  const curAsphalt = mapById(current.asfalto);
  const prevAsphalt = mapById(previous?.asfalto);

  const newContracts = [];
  const changedContracts = [];
  const newSuppliers = [];
  const newDiary = [];
  const newIssues = [];
  const resolvedIssues = [];
  const newAsphalt = [];

  for (const contract of current.contratos) {
    const before = prevContracts.get(contract.id);
    if (!before) {
      newContracts.push(contract);
      items.push({
        tipo: "novo_contrato",
        prioridade: contract.valor_brl >= 1_000_000 ? "alta" : contract.valor_brl >= 100_000 ? "media" : "baixa",
        titulo: `Novo contrato ${contract.numero || "s/n"}/${contract.ano || ""} - ${contract.fornecedor || "fornecedor nao informado"}`,
        detalhe: contract.objeto || "Objeto nao informado",
        orgao: contract.orgao,
        data: contract.data,
        valor_brl: contract.valor_brl,
        alvo_id: itemLinkId(contract),
      });
      continue;
    }
    if (Math.abs(contract.valor_brl - before.valor_brl) > MONEY_EPSILON) {
      const delta = contract.valor_brl - before.valor_brl;
      changedContracts.push({ contract, before, delta });
      items.push({
        tipo: "valor_alterado",
        prioridade: Math.abs(delta) >= 100_000 ? "alta" : "media",
        titulo: `Valor alterado no contrato ${contract.numero || "s/n"}/${contract.ano || ""}`,
        detalhe: `${contract.fornecedor || "Fornecedor nao informado"}: antes ${fmtBRL(before.valor_brl)}, agora ${fmtBRL(contract.valor_brl)}.`,
        orgao: contract.orgao,
        data: contract.data,
        valor_brl: contract.valor_brl,
        delta_brl: delta,
        alvo_id: itemLinkId(contract),
      });
    }
  }

  for (const supplier of current.fornecedores) {
    if (!prevSuppliers.has(supplier.id) && supplier.valor_brl >= RELEVANT_SUPPLIER_MIN) {
      newSuppliers.push(supplier);
      items.push({
        tipo: "novo_fornecedor_relevante",
        prioridade: supplier.valor_brl >= 1_000_000 ? "alta" : "media",
        titulo: `Fornecedor entrou no ranking: ${supplier.nome}`,
        detalhe: `${supplier.orgao} - rank ${supplier.rank}, ${fmtBRL(supplier.valor_brl)} no recorte atual.`,
        orgao: supplier.orgao,
        valor_brl: supplier.valor_brl,
      });
    }
  }

  for (const edition of current.diario) {
    if (!prevDiary.has(edition.id)) {
      newDiary.push(edition);
      items.push({
        tipo: "nova_edicao_diario",
        prioridade: edition.extra ? "alta" : "media",
        titulo: `Nova edicao do Diario Oficial ${edition.edicao || ""}`,
        detalhe: edition.extra ? "Edicao extra publicada na fonte oficial." : "Edicao ordinaria publicada na fonte oficial.",
        data: edition.data,
        url: edition.url,
      });
    }
  }

  for (const issue of current.pendencias) {
    if (!prevIssues.has(issue.id)) {
      newIssues.push(issue);
      items.push({
        tipo: "pendencia_nova",
        prioridade: issue.severity === "error" ? "alta" : "media",
        titulo: issue.title,
        detalhe: issue.detail || issue.action,
        fonte: issue.source,
      });
    }
  }

  for (const issue of previous?.pendencias || []) {
    if (!curIssues.has(issue.id)) {
      resolvedIssues.push(issue);
      items.push({
        tipo: "pendencia_resolvida",
        prioridade: "baixa",
        titulo: `Pendencia saiu da fila: ${issue.title}`,
        detalhe: issue.detail || "Este ponto nao apareceu mais na auditoria atual.",
        fonte: issue.source,
      });
    }
  }

  for (const asphalt of current.asfalto) {
    if (!prevAsphalt.has(asphalt.id)) {
      newAsphalt.push(asphalt);
      items.push({
        tipo: "asfalto_novo",
        prioridade: asphalt.valor_brl >= 1_000_000 ? "alta" : "media",
        titulo: `Novo item de asfalto/obra viaria: ${asphalt.fornecedor || "fornecedor nao informado"}`,
        detalhe: asphalt.objeto,
        orgao: asphalt.orgao,
        data: asphalt.data,
        valor_brl: asphalt.valor_brl,
        alvo_id: itemLinkId(asphalt),
      });
    }
  }

  const priorityRank = { alta: 3, media: 2, baixa: 1 };
  items.sort((a, b) => {
    const prio = (priorityRank[b.prioridade] || 0) - (priorityRank[a.prioridade] || 0);
    if (prio) return prio;
    return number(b.valor_brl) - number(a.valor_brl);
  });

  return {
    schema_version: 1,
    gerado_em: new Date().toISOString(),
    modo: previous ? "comparacao" : "baseline",
    atual: {
      snapshot_id: current.snapshot_id,
      coleta_iso: current.coleta_iso,
      data_humana: current.data_humana,
      arquivo: `data/snapshots/${current.snapshot_id}.json`,
    },
    anterior: previous ? {
      snapshot_id: previous.snapshot_id,
      coleta_iso: previous.coleta_iso,
      data_humana: previous.data_humana || "",
      arquivo: previous._public_path || "",
      origem: previous.source || "snapshot",
    } : null,
    resumo: {
      novos_contratos: newContracts.length,
      contratos_valor_alterado: changedContracts.length,
      novos_fornecedores_relevantes: newSuppliers.length,
      novas_edicoes_diario: newDiary.length,
      pendencias_novas: newIssues.length,
      pendencias_resolvidas: resolvedIssues.length,
      asfalto_novos: newAsphalt.length,
      valor_novo_brl: newContracts.reduce((sum, item) => sum + item.valor_brl, 0),
      valor_delta_brl: changedContracts.reduce((sum, item) => sum + item.delta, 0),
      total_mudancas: items.length,
    },
    itens: items.slice(0, 80),
    avisos: previous ? [] : [
      "Historico de snapshots iniciado agora. A proxima coleta automatica ja tera comparacao completa com este retrato.",
    ],
  };
}

function updateManifest() {
  const manifest = readJson(manifestPath, { gerado_em: new Date().toISOString(), chunks: {} });
  manifest.gerado_em = new Date().toISOString();
  manifest.chunks = {};
  const names = fs.readdirSync(chunksDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();

  for (const name of names) {
    const file = path.join(chunksDir, `${name}.json`);
    manifest.chunks[name] = {
      arquivo: `data/chunks/${name}.json`,
      bytes: fs.statSync(file).size,
      atualizado_em: fs.statSync(file).mtime.toISOString(),
      sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    };
  }

  const snapshotFiles = fs.existsSync(snapshotsDir)
    ? fs.readdirSync(snapshotsDir).filter((name) => name.endsWith(".json")).sort()
    : [];
  manifest.snapshots = {
    diretorio: "data/snapshots",
    total: snapshotFiles.length,
    ultimo: snapshotFiles[snapshotFiles.length - 1] || "",
    arquivos: Object.fromEntries(snapshotFiles.map((name) => {
      const file = path.join(snapshotsDir, name);
      return [name, {
        bytes: fs.statSync(file).size,
        sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      }];
    })),
  };
  writeJson(manifestPath, manifest);
}

function pruneSnapshots() {
  if (!fs.existsSync(snapshotsDir)) return;
  const files = fs.readdirSync(snapshotsDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const remove = files.slice(0, Math.max(0, files.length - SNAPSHOT_LIMIT));
  for (const name of remove) fs.unlinkSync(path.join(snapshotsDir, name));
}

const current = buildSnapshotFromChunks(chunksDir, "chunks");
let previous = null;

if (previousChunksDir && fs.existsSync(previousChunksDir)) {
  previous = buildSnapshotFromChunks(previousChunksDir, "backup_pre_coleta");
} else {
  previous = latestPublicSnapshot(current.snapshot_id);
}

const currentPath = path.join(snapshotsDir, `${current.snapshot_id}.json`);
writeJson(currentPath, current);
const existingDiff = readJson(outChunkPath);
if (!previous && existingDiff?.modo === "comparacao" && existingDiff?.atual?.snapshot_id === current.snapshot_id) {
  pruneSnapshots();
  updateManifest();
  console.log(`Snapshot atual: data/snapshots/${current.snapshot_id}.json`);
  console.log("Comparacao existente preservada para esta coleta.");
  console.log(`Chunk preservado: data/chunks/mudancas_coleta.json (${existingDiff.resumo?.total_mudancas || 0} mudanca(s))`);
  process.exit(0);
}
const diff = diffSnapshots(current, previous);
writeJson(outChunkPath, diff);
pruneSnapshots();
updateManifest();

console.log(`Snapshot atual: data/snapshots/${current.snapshot_id}.json`);
console.log(previous ? `Comparado com: ${previous.snapshot_id}` : "Historico iniciado: sem snapshot anterior.");
console.log(`Chunk gerado: data/chunks/mudancas_coleta.json (${diff.resumo.total_mudancas} mudanca(s))`);
