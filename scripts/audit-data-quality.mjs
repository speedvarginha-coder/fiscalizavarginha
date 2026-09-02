#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { agruparSancoes, avaliarIncompatibilidade, CATEGORIAS } from "./lib/classificar-sancoes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const painelDir = path.join(root, "painel-cidadao");
const chunksDir = path.join(painelDir, "data", "chunks");
const manifestPath = path.join(painelDir, "data", "manifest.json");
const outPath = path.join(chunksDir, "auditoria_dados.json");
const statusPath = path.join(chunksDir, "status_fontes.json");
const strict = process.argv.includes("--strict");
const noExitCode = process.argv.includes("--no-exit-code");

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

  manifest.gerado_em = new Date().toISOString();
  manifest.chunks = {};
  const names = fs.readdirSync(chunksDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.basename(name, ".json"))
    .sort();

  for (const name of names) {
    const filePath = path.join(chunksDir, `${name}.json`);
    manifest.chunks[name] = {
      arquivo: `data/chunks/${name}.json`,
      bytes: fs.statSync(filePath).size,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
    };
  }

  const snapshotsDir = path.join(painelDir, "data", "snapshots");
  const snapshots = fs.existsSync(snapshotsDir)
    ? fs.readdirSync(snapshotsDir).filter((name) => name.endsWith(".json")).sort()
    : [];
  manifest.snapshots = {
    diretorio: "data/snapshots",
    total: snapshots.length,
    ultimo: snapshots.at(-1) || "",
    arquivos: Object.fromEntries(snapshots.map((name) => {
      const filePath = path.join(snapshotsDir, name);
      return [name, {
        bytes: fs.statSync(filePath).size,
        sha256: crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
      }];
    })),
  };

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

// Mapa nome normalizado -> raiz de CNPJ, construído da base cadastral
// (cnpjs.json). Resolve fornecedores que chegam só com o nome (ex.: top da
// Câmara) para que o casamento exato por CNPJ funcione mesmo sem o campo.
let nameToCnpjRoot = new Map();
function buildNameToCnpjRoot(cnpjsChunk) {
  const map = new Map();
  const registrar = (nome, cnpj) => {
    const key = normalizeText(nome);
    const root = cnpjRoot(cnpj);
    if (key && root && !map.has(key)) map.set(key, root);
  };
  for (const e of cnpjsChunk?.empresas || []) {
    registrar(e.razao_social, e.cnpj);
    registrar(e.nome_fantasia, e.cnpj);
  }
  for (const f of cnpjsChunk?.fornecedores || []) {
    registrar(f.nome, f.cnpj_completo || f.cnpj_raiz);
    registrar(f.razao_social, f.cnpj_completo || f.cnpj_raiz);
  }
  return map;
}

function supplierHasContract(supplier, contracts) {
  const root = cnpjRoot(supplier?.cnpj)
    || nameToCnpjRoot.get(normalizeText(supplier?.nome)) || "";
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
  federal: readJson("federal"),
  cnpjs: readJson("cnpjs"),
  fontesEmendas2026: readJson("fontes_emendas_2026"),
  indice: readJson("indice_relevancia"),
  diario: readJson("diario"),
  camaraAnos: readJson("camara_anos"),
  publicacoesCamara: readJson("publicacoes_estruturadas"),
  publicacoesDiario: readJson("publicacoes_diario"),
  sancoes: readJson("sancoes"),
  tseDoacoes: readJson("tse_doacoes"),
  licitacoesResultados: readJson("licitacoes_resultados"),
  remuneracaoVereadores: readJson("remuneracao_vereadores"),
};

function contractHealth(chunk) {
  const exports = Object.fromEntries(
    Object.entries(chunk?.dados_abertos_status || {})
      .filter(([key]) => normalizeText(key).includes("CONTRATO")),
  );
  return {
    contratos_status_coleta: chunk?.contratos_status_coleta,
    exports,
  };
}

function hasUnreliableCollectionStatus(value) {
  return /preserv|parcial|partial|failed|falha|erro|vazia/.test(
    JSON.stringify(value || {}).toLowerCase(),
  );
}

const contratosAuditaveis = !hasUnreliableCollectionStatus({
  prefeitura: contractHealth(chunks.prefeitura),
  camara: contractHealth(chunks.camaraBetha),
});
const obrasAuditaveis = !hasUnreliableCollectionStatus({
  status: chunks.prefeitura?.obras_status_coleta,
  exports: Object.fromEntries(
    Object.entries(chunks.prefeitura?.dados_abertos_status || {})
      .filter(([key]) => normalizeText(key).includes("OBRA")),
  ),
});

nameToCnpjRoot = buildNameToCnpjRoot(chunks.cnpjs);

const domainConfig = [
  ["atualizado_em", "Coleta principal", chunks.atualizado, 3],
  ["prefeitura", "Prefeitura/Betha", chunks.prefeitura, 7],
  ["camara_betha", "Camara/Betha", chunks.camaraBetha, 7],
  ["pessoal", "Pessoal", chunks.pessoal, 31],
  ["pncp", "PNCP", chunks.pncp, 15],
  ["federal", "Recursos federais / Transferegov", chunks.federal, 2],
  ["cnpjs", "CNPJs", chunks.cnpjs, 31],
  ["fontes_emendas_2026", "Fontes de emendas 2026", chunks.fontesEmendas2026, 31],
  ["indice_relevancia", "Indice de relevancia", chunks.indice, 31],
  ["diario", "Diario Oficial", chunks.diario, 5],
  ["camara_anos", "Camara/SAPL", chunks.camaraAnos, 7],
  ["publicacoes_estruturadas", "Publicacoes da Camara", chunks.publicacoesCamara, 7],
  ["publicacoes_diario", "Publicacoes do Diario", chunks.publicacoesDiario, 7],
];

function internalTimestamp(value) {
  if (!value || typeof value !== "object") return undefined;
  const timestampKeys = new Set([
    "iso", "atualizado_em", "ultima_atualizacao", "data_atualizacao",
    "coleta_iso", "coletado_em", "data_coleta", "gerado_em",
  ]);
  const pending = [value];
  const seen = new Set();
  while (pending.length) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const [key, item] of Object.entries(current)) {
      if (timestampKeys.has(key)) {
        const parsed = parseDate(item);
        if (parsed) return parsed;
      }
      if (item && typeof item === "object") pending.push(item);
    }
  }
  return undefined;
}

function sourceHealthMetadata(name, value) {
  if (!value || typeof value !== "object") return {};

  // Nunca classificar a saude pela base inteira. Campos de negocio podem conter
  // palavras como "PARCIAL" (tipo de empreitada) ou "preservado" (texto de uma
  // materia legislativa) sem indicar qualquer falha de coleta.
  const commonKeys = [
    "status", "status_fontes", "observacao", "observacoes", "erros", "erro",
    "resumo", "consultas", "fontes_verificadas", "cobertura", "metadados", "metadata",
    "contratos_status_coleta", "obras_status_coleta", "frota_status_coleta",
    "dados_abertos_status", "meta",
  ];
  const metadata = Object.fromEntries(
    commonKeys
      .filter((key) => Object.hasOwn(value, key))
      .map((key) => [key, value[key]]),
  );

  // O indice declara a cobertura por ano fora dos campos comuns.
  if (name === "indice_relevancia" && value.anos) {
    metadata.anos = Object.fromEntries(
      Object.entries(value.anos).map(([year, item]) => [year, {
        status: item?.status,
        cobertura_pct: item?.cobertura_pct,
        confianca_dados_pct: item?.confianca_dados_pct,
      }]),
    );
  }
  return metadata;
}

function buildSourceStatus() {
  const domains = {};
  for (const [name, label, value, maxAgeDays] of domainConfig) {
    const empty = value === undefined
      || value === null
      || (Array.isArray(value) && value.length === 0)
      || (!Array.isArray(value) && typeof value === "object" && Object.keys(value).length === 0);
    const metadataText = JSON.stringify(sourceHealthMetadata(name, value)).toLowerCase();
    // prefeitura.json e produzido pelo coletor principal, mas por compatibilidade
    // ainda nao carrega timestamp proprio. Nesse caso, usa o carimbo do mesmo ciclo.
    const updatedAt = internalTimestamp(value)
      || (name === "prefeitura" ? internalTimestamp(chunks.atualizado) : undefined);
    const ageDays = daysSince(updatedAt);
    let status;
    let reason;

    if (empty) {
      status = "failed";
      reason = value === undefined ? "Chunk ausente." : "Chunk vazio; ausencia real de registros nao foi confirmada.";
    } else if (/preservad[oa]|preservada_por_cobertura/.test(metadataText)) {
      status = "preserved";
      reason = "Metadados indicam preservacao da ultima base valida.";
    } else if (/\"status\"\s*:\s*\"(?:erro|failed|falha)\"|erro de coleta|falha de coleta|http error|http \d{3}/.test(metadataText)) {
      const pncpSemDados = name === "pncp"
        && !(value?.compras?.length || value?.contratos?.length);
      status = pncpSemDados ? "failed" : "partial";
      reason = pncpSemDados
        ? "A fonte falhou e nao retornou registros; zero nao significa ausencia de contratacoes."
        : "Parte da coleta apresentou erro; os registros validos foram preservados.";
    } else if (/parcial|cobertura baixa|escopo limitado/.test(metadataText)) {
      status = "partial";
      reason = "Metadados indicam cobertura parcial.";
    } else if (!updatedAt) {
      status = "manual";
      reason = "Sem timestamp interno verificavel; mtime local nao foi usado como freshness.";
    } else if (ageDays > maxAgeDays) {
      status = "stale";
      reason = `Timestamp interno excede a janela de ${maxAgeDays} dias.`;
    } else {
      status = "ok";
      reason = "Timestamp interno dentro da janela esperada.";
    }

    domains[name] = {
      label,
      status,
      source_updated_at: updatedAt?.toISOString() || null,
      age_days: Number.isFinite(ageDays) ? Number(ageDays.toFixed(1)) : null,
      max_age_days: maxAgeDays,
      reason,
    };
  }
  return { schema_version: 1, gerado_em: new Date().toISOString(), domains };
}

const items = [];

// blocksPipeline distingue DEFEITO DE PIPELINE (schema quebrado, chunk
// ausente, feed defasado — o dado nao esta pronto para publicar) de ACHADO
// DE CONTEUDO (fornecedor sancionado, homologacao simbolica — o dado esta
// correto e PRECISA ser publicado). So o primeiro tipo trava a publicacao
// automatica; o segundo continua contando como severidade "error" na tela
// e no IFT (achado grave e grave), mas nao impede o ciclo diario de rodar.
function add(severity, id, title, detail, action, source = "", {
  blocksPipeline = true,
  verification,
} = {}) {
  items.push({
    severity,
    id,
    title: cleanPublishedText(title),
    detail: cleanPublishedText(detail),
    action: cleanPublishedText(action),
    source,
    verification,
    blocksPipeline: severity === "error" ? blocksPipeline : undefined,
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

// O subsidio de vereador e fixado em LEI, nao vem de feed: so muda quando outra
// lei o altera. O risco e o registro envelhecer em silencio apos uma revisao.
// Em vez de vigiar o texto da lei, compara com a folha REAL, que ja e coletada.
// NAO acusa ninguem, de proposito: "vencimentos" e bruto e inclui verbas alem
// do subsidio base (presidencia, tercos), e a folha traz 13o/rescisao/ferias que
// inflam o valor — comparar cru mostraria "vereador 76% acima da lei", que e
// falso. Por isso: cargo exatamente "VEREADOR" (fora presidente/vice), so folha
// mensal pura, e MEDIANA (um caso isolado nao dispara). O achado e sobre o DADO
// estar velho, nao sobre alguem receber a mais.
const subsidioLei = Number(chunks.remuneracaoVereadores?.subsidio_bruto_mensal_brl || 0);
const servidoresCamara = chunks.pessoal?.camara?.servidores || [];
if (subsidioLei > 0 && servidoresCamara.length) {
  const folhaNaoMensal = /13|RESCIS|F[EÉ]RIAS/i;
  const brutos = servidoresCamara
    .filter((s) => String(s.cargo || "").trim().toUpperCase() === "VEREADOR")
    .filter((s) => Array.isArray(s.tipos_folha) && s.tipos_folha.length
      && !s.tipos_folha.some((t) => folhaNaoMensal.test(String(t))))
    .map((s) => Number(s.vencimentos || 0))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (brutos.length >= 5) {
    const mediana = brutos[Math.floor(brutos.length / 2)];
    const divergencia = (mediana / subsidioLei - 1) * 100;
    if (Math.abs(divergencia) > 10) {
      const leiNum = chunks.remuneracaoVereadores?.lei?.numero || "lei registrada";
      add(
        "warning",
        "subsidio-vereador-desatualizado",
        "Subsidio de vereador registrado pode estar desatualizado",
        `A folha mensal paga tem mediana de R$ ${mediana.toFixed(2)}, contra R$ ${subsidioLei.toFixed(2)} `
        + `fixados na ${leiNum} (${divergencia >= 0 ? "+" : ""}${divergencia.toFixed(1)}%). `
        + "Divergencia grande costuma indicar lei de revisao aprovada e ainda nao registrada aqui.",
        `Conferir se houve lei revisando o subsidio e atualizar remuneracao_vereadores.json (${leiNum}).`,
        "remuneracao_vereadores.json",
        { verification: {
          estado: "divergencia_detectada",
          metodo: "mediana da folha mensal pura, cargo VEREADOR, sem 13o/rescisao/ferias",
          confianca: "media",
          evidencias: [`${brutos.length} registros de folha mensal comparados`],
          limitacoes: ["Vencimentos e bruto e pode incluir verbas alem do subsidio base"],
        } },
      );
    }
  }
}

// Segunda guarda para o mesmo risco, por outro caminho: procura nas publicacoes
// JA COLETADAS (SAPL da Camara + Diario) uma materia que fixe ou revise subsidio
// de vereador com data POSTERIOR a lei registrada. Nao precisa scraper novo — a
// materia legislativa ja chega pela coleta. Enquanto a divergencia de folha
// (acima) pega o efeito, esta pega a causa, e costuma aparecer antes.
const leiData = String(chunks.remuneracaoVereadores?.lei?.data || "");
if (leiData) {
  const ehSubsidioVereador = (texto) => /subs[ií]dio/i.test(texto)
    && /vereador|agentes?\s+pol[ií]ticos/i.test(texto)
    && /fixa|revis|altera|reajust/i.test(texto);
  const candidatas = [
    ...(chunks.publicacoesCamara?.publicacoes || []),
    ...(chunks.publicacoesDiario?.publicacoes || []),
  ].filter((p) => {
    const data = String(p?.data || "").slice(0, 10);
    if (!data || data <= leiData) return false;
    return ehSubsidioVereador(`${p?.titulo || ""} ${p?.ementa || ""} ${p?.resumo || ""} ${p?.o_que_propoe || ""}`);
  });
  if (candidatas.length) {
    const exemplos = candidatas.slice(0, 3)
      .map((p) => `${String(p.titulo || "ato").slice(0, 60)} (${String(p.data).slice(0, 10)})`)
      .join("; ");
    add(
      "warning",
      "subsidio-vereador-lei-nova",
      "Possivel lei nova sobre subsidio de vereador",
      `${candidatas.length} publicacao(oes) posterior(es) a ${chunks.remuneracaoVereadores?.lei?.numero || "lei registrada"} `
      + `mencionam fixacao/revisao de subsidio de vereador. Exemplos: ${exemplos}.`,
      "Ler a materia e, se alterar o subsidio, atualizar remuneracao_vereadores.json com a nova lei.",
      "remuneracao_vereadores.json",
      { verification: {
        estado: "candidato_localizado",
        metodo: "busca textual em publicacoes coletadas (SAPL + Diario) posteriores a lei registrada",
        confianca: "baixa",
        evidencias: [`${candidatas.length} publicacao(oes) candidata(s)`],
        limitacoes: ["Busca textual: pode trazer materia que apenas cita subsidio sem alterar valor"],
      } },
    );
  }
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

// --- Sócio em comum entre empresas distintas da base cadastral ---
// O QSA vem só com o NOME do sócio (sem CPF), então homônimos são possíveis:
// isto é um indício a verificar, nunca uma conclusão. Duas empresas com sócio
// em comum recebendo recurso público merecem conferência humana (a lei não
// proíbe; o risco fiscalizável é participação alternada em licitações).
{
  const socioMap = new Map();
  for (const emp of chunks.cnpjs?.empresas || []) {
    const raiz = cnpjRoot(emp.cnpj);
    const nomeEmp = emp.razao_social || emp.nome_fantasia || "";
    if (!raiz || /MUNICIPIO|PREFEITURA|CAMARA MUNICIPAL|FUNDO MUNICIPAL/.test(normalizeText(nomeEmp))) continue;
    for (const socio of emp.socios || []) {
      const key = normalizeText(socio);
      if (!key || key.split(" ").length < 2) continue;
      if (!socioMap.has(key)) socioMap.set(key, new Map());
      socioMap.get(key).set(raiz, nomeEmp);
    }
  }
  const vinculos = [];
  for (const [socio, empresas] of socioMap) {
    if (empresas.size >= 2) {
      vinculos.push({ socio, empresas: [...empresas.values()] });
    }
  }
  if (vinculos.length) {
    add(
      "warning",
      "socios-em-comum",
      "Empresas da base com socio em comum (indicio a verificar)",
      `${vinculos.length} nome(s) de socio aparecem em 2+ empresas distintas que receberam recurso publico. Exemplos: ${vinculos.slice(0, 3).map((v) => `${v.socio} (${v.empresas.slice(0, 2).join(" e ")})`).join("; ")}. O QSA nao traz CPF: homonimos sao possiveis e isto NAO e conclusao de irregularidade.`,
      "Conferir manualmente os quadros societarios e verificar se as empresas disputaram as mesmas licitacoes antes de qualquer divulgacao.",
      "cnpjs.json",
      { verification: {
        estado: "indicio_a_verificar",
        metodo: "nome_normalizado_de_socio_em_qsa",
        confianca: "baixa",
        evidencias: [`${vinculos.length} nome(s) em duas ou mais empresas`],
        limitacoes: ["QSA sem CPF permite homonimos", "Socio em comum nao implica irregularidade"],
      } },
    );
  }
}

const camaraTop = (chunks.camaraBetha?.top_fornecedores_atual || []).slice(0, 20);
// Os maiores pagadores incluem fornecedores da Prefeitura; cruza contra os
// contratos das duas esferas para não acusar "sem contrato" um fornecedor que
// tem contrato na Prefeitura (ex.: a agência VERSAO BR, contrato plurianual).
const camaraContracts = [
  ...(chunks.camaraBetha?.contratos || []),
  ...(chunks.prefeitura?.contratos || []),
];
if (contratosAuditaveis && camaraTop.length && camaraContracts.length) {
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
      `${semContrato.length} dos 20 maiores fornecedores de despesas nao bateram com contrato (verificado por CNPJ e por nome). Exemplos: ${semContrato.slice(0, 4).map((f) => f.nome).join("; ")}.${cauda}`,
      "Cruzar por CNPJ e conferir no Betha — pode ser contrato plurianual ainda nao coletado (a coleta agora resgata contratos vigentes de anos anteriores).",
      "camara_betha.json",
      { verification: {
        estado: "nao_localizado",
        metodo: "raiz_cnpj_com_fallback_por_nome",
        confianca: "baixa",
        evidencias: [`${semContrato.length} fornecedor(es) sem correspondencia automatica`],
        limitacoes: ["Pode haver contrato plurianual ou instrumento equivalente", "Correspondencia por nome pode falhar com abreviacoes"],
      } },
    );
  }
}

// --- NOVOS CHECKS DE QUALIDADE FORENSE ---
const prefeituraTop = (chunks.prefeitura?.top_fornecedores_atual || []).slice(0, 30);
// Obras publicas entram no corpo de busca junto com os contratos: elas ja trazem
// "contratado"/"cnpj" (mesmos campos que o matcher usa) e ainda referenciam
// contrato_numero. Sem elas o alerta acusava de "sem contrato" fornecedor que
// tem obra registrada — a PAVICAN aparecia como R$ 14,4M "sem contrato" tendo
// 57 obras na base, o que induz a leitura de irregularidade onde ha vinculo
// documentado, so registrado noutra aba.
const prefeituraContracts = [
  ...(chunks.prefeitura?.contratos || []),
  ...(chunks.camaraBetha?.contratos || []),
  ...(chunks.prefeitura?.obras_publicas || []),
];
if (contratosAuditaveis && obrasAuditaveis && prefeituraTop.length && prefeituraContracts.length) {
  const unmatched = prefeituraTop.filter((supplier) => !supplierHasContract(supplier, prefeituraContracts));
  const semContrato = unmatched.filter((f) => gapKind(f.nome) === "fornecedor" && Number(f.valor_total || 0) > 1000000);
  if (semContrato.length) {
    add(
      "warning",
      "prefeitura-despesa-sem-contrato",
      "Fornecedores de grande porte sem contrato nem obra vinculada automaticamente",
      `${semContrato.length} fornecedor(es) com despesa > R$ 1M nao possuem contrato localizado. Exemplos: ${semContrato.slice(0, 4).map((f) => `${f.nome} (R$ ${(f.valor_total/1000000).toFixed(1)}M)`).join("; ")}.`,
      "Verificar se ha contrato plurianual nao publicado, dispensa/inexigibilidade nao integrada ou repasse SUS/saude nao classificado.",
      "prefeitura.json",
      { verification: {
        estado: "nao_localizado",
        metodo: "raiz_cnpj_com_fallback_por_nome",
        confianca: "baixa",
        evidencias: [`${semContrato.length} fornecedor(es) acima de R$ 1 milhao sem correspondencia`],
        limitacoes: ["Pode ser repasse, contrato plurianual, dispensa ou inexigibilidade fora da base"],
      } },
    );
  }
}
const cnpjInvalidos = Array.isArray(chunks.cnpjs?.invalidos) ? chunks.cnpjs.invalidos : [];
if (cnpjInvalidos.length) {
  add(
    "warning",
    "cnpj-invalidos-na-fonte",
    "CNPJ invalido na fonte de origem",
    `${cnpjInvalidos.length} CNPJ(s) tem digitos verificadores invalidos e nao foi consultado nas bases auxiliares. O sistema preserva o valor informado, mas nao atribui cadastro a outra empresa por aproximacao.`,
    "Conferir o documento da emenda ou pedir correcao do CNPJ ao orgao responsavel pela publicacao.",
    "cnpjs.json",
  );
}

if (!contratosAuditaveis || !obrasAuditaveis) {
  add(
    "warning",
    "auditoria-vinculos-suspensa-por-frescor",
    "Cruzamentos de fornecedores e contratos temporariamente suspensos",
    "A ultima base valida permanece publicada, mas contratos ou obras nao foram coletados integralmente no ciclo atual. Por seguranca, o sistema nao gera novos alertas nominais de fornecedor sem contrato nem de incompatibilidade contratual enquanto a fonte estiver preservada ou parcial.",
    "Restabelecer a coleta Betha, validar a cobertura e somente depois reativar os cruzamentos nominais.",
    "prefeitura.json",
    { verification: {
      estado: "fonte_desatualizada",
      metodo: "trava_de_frescor_por_dataset",
      confianca: "alta",
      evidencias: ["Metadados de contratos/obras indicam coleta preservada, parcial ou falha"],
      limitacoes: ["A base anterior continua visivel, mas pode nao conter publicacoes recentes"],
    } },
  );
}

for (const [orgao, registros, source] of [
  ["Prefeitura", chunks.prefeitura?.contratos || [], "prefeitura.json"],
  ["Camara", chunks.camaraBetha?.contratos || [], "camara_betha.json"],
]) {
  const semModalidade = registros.filter((c) => !String(c.modalidade || "").trim()).length;
  if (registros.length && semModalidade) {
    add(
      "warning",
      `contratos-${normalizeText(orgao)}-sem-modalidade`,
      `Modalidade de compra ausente em contratos da ${orgao}`,
      `${semModalidade} de ${registros.length} contrato(s) nao informam modalidade no retorno contratual da fonte. Numero, objeto, contratado, valor e datas permanecem publicados quando disponiveis, mas o contrato isolado nao permite classificar a origem como licitacao, dispensa ou inexigibilidade.`,
      "Cruzar o contrato com a consulta de licitacoes/compras diretas ou solicitar o processo antes de classificar a forma de contratacao.",
      source,
    );
  }
}

const anoDiarias = Number(chunks.prefeitura?.ano_atual || new Date().getFullYear());
for (const [orgao, registros] of [
  ["Prefeitura", chunks.diarias?.prefeitura || []],
  ["Camara", chunks.diarias?.camara || []],
]) {
  const atuais = registros.filter((d) => Number(d.ano) === anoDiarias);
  const semDestino = atuais.filter((d) => !String(d.destino || "").trim()).length;
  const semFinalidade = atuais.filter((d) => !String(d.finalidade || "").trim()).length;
  if (atuais.length && (semDestino || semFinalidade)) {
    add(
      "warning",
      `diarias-${normalizeText(orgao)}-sem-detalhamento`,
      `Diarias da ${orgao} com detalhamento incompleto`,
      `Em ${anoDiarias}, a base tem ${atuais.length} registro(s): ${semDestino} sem destino e ${semFinalidade} sem finalidade. Valor, beneficiario e periodo continuam auditaveis quando preenchidos, mas a motivacao da viagem nao pode ser inferida.`,
      "Conferir o ato original e solicitar destino, finalidade, relatorio de viagem e comprovantes antes de avaliar necessidade ou resultado da despesa.",
      "diarias.json",
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

if (contratosAuditaveis && prefeituraContratosTotal > 0) {
  const pctInexDisp = (prefeituraInexDispTotal / prefeituraContratosTotal) * 100;
  if (pctInexDisp > 20) {
    add(
      "warning",
      "prefeitura-contratos-sem-competicao",
      "Participacao relevante de contratacoes diretas",
      `Contratos por Inexigibilidade ou Dispensa somam ${pctInexDisp.toFixed(1)}% (R$ ${(prefeituraInexDispTotal / 1000000).toFixed(1)}M de R$ ${(prefeituraContratosTotal / 1000000).toFixed(1)}M).`,
      "Conferir nas maiores inexigibilidades e dispensas o fundamento legal, a justificativa de preco, a publicidade e a documentacao do processo.",
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
    "Emendas de alto valor sem pagamento localizado no cruzamento",
    `${emendasSemPagamentoAlto.length} emenda(s) de R$ 50k+ aparecem sem pagamento localizado no cruzamento automático. Exemplos: ${emendasSemPagamentoAlto.slice(0, 3).map((e) => `${e.beneficiario} (R$ ${(Number(e.valor_brl || e.valor)/1000).toFixed(0)}k - ${e.autor})`).join("; ")}.`,
    "Consultar secretaria responsavel se o plano de trabalho foi aprovado ou se ha atraso/impedimento tecnico.",
    "prefeitura.json",
    { verification: {
      estado: "nao_localizado",
      metodo: "raiz_cnpj_e_periodo",
      confianca: "baixa",
      evidencias: [`${emendasSemPagamentoAlto.length} emenda(s) sem pagamento localizado`],
      limitacoes: ["Ausencia no cruzamento nao prova falta de execucao", "Pagamento ao mesmo CNPJ nao comprova origem na emenda"],
    } },
  );
}

// --- Sanções CEIS/CNEP ---
// O alcance de cada sanção vem do campo oficial `abrangencia` do registro, NÃO
// do nome do tipo. A base tem declaração de inidoneidade com abrangência
// "Todas as Esferas em todos os Poderes" e outra com "Na Esfera e no Poder do
// órgão sancionador" — deduzir alcance do rótulo publicou afirmação errada
// sobre a segunda em 04/08/2026. A classificação mora em
// scripts/lib/classificar-sancoes.mjs para ser testável com casos sintéticos.
if (chunks.sancoes?.sancoes_vigentes > 0) {
  const vigentes = (chunks.sancoes.achados || []).filter((a) => a.sancao_vigente);
  const grupos = agruparSancoes(vigentes);
  const geral = grupos[CATEGORIAS.ALCANCE_GERAL];
  const atingeVarginha = grupos[CATEGORIAS.ALCANCE_VARGINHA];
  const informativas = grupos[CATEGORIAS.OUTRO_ENTE];
  const revisaoManual = [
    ...grupos[CATEGORIAS.MULTA],
    ...grupos[CATEGORIAS.ALCANCE_DESCONHECIDO],
    ...grupos[CATEGORIAS.CONFLITO_ENTRE_CAMPOS],
  ];
  // Nominar exige categoria com alcance sobre Varginha E dossiê completo.
  const nominaveis = [...geral, ...atingeVarginha].filter((a) => a._pode_nominar);
  const semDossie = [...geral, ...atingeVarginha].filter((a) => !a._pode_nominar);

  const descreve = (a) => `${a.fornecedor_local} (registro ${a.base.toUpperCase()} classificado pelo orgao informante como "${a.tipo}", abrangencia "${a.abrangencia}", aplicada por ${a.orgao_sancionador}, processo ${a.numero_processo}, vigencia ate ${a.data_fim || "sem prazo informado"}, verificacao humana em ${a.verificacao_manual?.data_verificacao || "data ausente"})`;

  if (nominaveis.length) {
    add(
      "error",
      "sancao-com-alcance-sobre-varginha",
      "Registros de sancao com alcance que atinge Varginha",
      `Foi localizado no cadastro federal ${nominaveis.length} registro(s) de sancao vigente vinculado(s) a fornecedor(es) do painel cuja abrangencia declarada alcanca a administracao de Varginha: ${nominaveis.slice(0, 3).map(descreve).join("; ")}. O conteudo do cadastro e de responsabilidade do orgao que o alimenta. O registro nao prova, por si so, contratacao irregular — para isso e preciso contrato local ativo com datas sobrepostas a vigencia da sancao.`,
      "Abrir o registro individual no Portal da Transparencia, conferir categoria, fundamentacao, abrangencia, situacao e processo; so entao verificar contrato local com datas sobrepostas.",
      "sancoes.json",
      { blocksPipeline: false, verification: {
        estado: "requer_confirmacao_documental",
        metodo: "abrangencia_oficial_do_registro",
        confianca: "media",
        evidencias: nominaveis.slice(0, 3).map((a) => `${a.fornecedor_local}: ${a.abrangencia} (processo ${a.numero_processo})`),
        limitacoes: [
          "CNPJ do lado local vem mascarado pela fonte — casamento por raiz, nao exato",
          "Raiz de CNPJ nao distingue matriz de filial",
          "Registro de sancao nao prova contratacao irregular",
        ],
      } },
    );
  }
  // Sanção + contrato local + datas sobrepostas + alcance aplicável. Só o
  // conjunto completo levanta hipótese, e ainda assim como pergunta.
  const contratosLocais = [
    ...(chunks.prefeitura?.contratos || []),
    ...(chunks.camaraBetha?.contratos || []),
  ];
  const casosEsclarecimento = contratosAuditaveis
    ? nominaveis
      .map((a) => ({ sancao: a, ...avaliarIncompatibilidade(a, contratosLocais) }))
      .filter((r) => r.caso_para_esclarecimento)
    : [];

  if (casosEsclarecimento.length) {
    add(
      "error",
      "possivel-incompatibilidade-contratual",
      "Possivel incompatibilidade entre sancao vigente e contrato local",
      `${casosEsclarecimento.length} caso(s) reunem simultaneamente: registro de sancao vigente com abrangencia que alcanca Varginha, contrato local com o mesmo CNPJ raiz e periodos sobrepostos. ${casosEsclarecimento.slice(0, 3).map((r) => `${r.sancao.fornecedor_local} (sancao de ${r.sancao.data_inicio} a ${r.sancao.data_fim || "sem prazo"}; ${r.contratos_sobrepostos.length} contrato(s) local(is) no periodo)`).join("; ")}. Isto e possivel incompatibilidade a esclarecer e NAO comprova ilegalidade na contratacao. A confirmacao depende de ler o ato sancionador, o contrato e a data efetiva de cada um.`,
      "Solicitar esclarecimento formal ao orgao contratante sobre a compatibilidade entre a sancao registrada e o contrato vigente, anexando o registro individual do CEIS.",
      "sancoes.json",
      { blocksPipeline: false, verification: {
        estado: "requer_confirmacao_documental",
        metodo: "raiz_cnpj_x_periodo_x_abrangencia",
        confianca: "media",
        evidencias: casosEsclarecimento.slice(0, 3).map((r) => `${r.sancao.fornecedor_local}: processo ${r.sancao.numero_processo}, ${r.contratos_sobrepostos.length} contrato(s) sobreposto(s)`),
        limitacoes: [
          "Raiz de CNPJ nao distingue matriz de filial — o contrato pode ser de outro estabelecimento",
          "Sobreposicao de datas nao prova execucao simultanea",
          "Sancao registrada nao prova contratacao irregular",
        ],
      } },
    );
  }

  if (semDossie.length) {
    add(
      "warning",
      "sancao-sem-dossie-completo",
      "Sancoes com alcance relevante mas evidencia incompleta",
      `${semDossie.length} registro(s) tem abrangencia que alcancaria Varginha, mas estao sem os campos minimos para divulgacao nominal. Faltas apuradas: ${[...new Set(semDossie.flatMap((a) => a._evidencias_faltantes))].join(", ")}. Enquanto faltar qualquer campo obrigatorio, o nome do fornecedor nao e publicado.`,
      "Completar a coleta dos campos faltantes ou conferir manualmente o registro individual antes de qualquer divulgacao nominal.",
      "sancoes.json",
      { verification: {
        estado: "requer_revisao_humana",
        metodo: "checagem_de_dossie_minimo",
        confianca: "baixa",
        evidencias: [`${semDossie.length} registro(s) sem dossie completo`],
        limitacoes: ["Sem os campos minimos nao ha base para afirmar alcance"],
      } },
    );
  }
  if (informativas.length) {
    const fornecedores = [...new Set(informativas.map((a) => a.fornecedor_local))];
    add(
      "warning",
      "fornecedor-sancionado-outro-ente",
      "Fornecedores com sancao vigente aplicada por outros entes",
      `${fornecedores.length} fornecedor(es)/contratado(s) constam com impedimento, suspensao ou multa vigente aplicada por OUTROS entes publicos (${informativas.length} sancoes). Pela Lei 14.133 essas sancoes valem perante o ente sancionador — nao impedem, por si, contratar com Varginha. Registro informativo de historico.`,
      "Usar como criterio de atencao em novas licitacoes; conferir caso a caso antes de qualquer divulgacao nominal.",
      "sancoes.json",
      { verification: {
        estado: "informativo",
        metodo: "fornecedor_local_x_ceis_cnep",
        confianca: "media",
        evidencias: [`${informativas.length} sancao(oes) de outros entes`],
        limitacoes: ["Impedimento de outro ente nao impede por si so contratar com Varginha"],
      } },
    );
  }
  if (revisaoManual.length) {
    // Sem nomes: sao exatamente os casos cujo alcance o sistema NAO conseguiu
    // determinar. Publicar nome aqui e o caminho mais curto para acusar errado.
    const porMotivo = revisaoManual.reduce((acc, a) => {
      acc[a._motivo_classificacao] = (acc[a._motivo_classificacao] || 0) + 1;
      return acc;
    }, {});
    add(
      "warning",
      "sancoes-sem-alcance-determinado",
      "Sancoes vigentes sem alcance determinavel automaticamente",
      `${revisaoManual.length} sancao(oes) vigente(s) ficam fora de qualquer alerta nominal porque o alcance nao pode ser afirmado com seguranca. Motivos: ${Object.entries(porMotivo).map(([m, n]) => `${n}x ${m}`).join("; ")}. O alcance e lido do campo oficial de abrangencia do registro, nunca deduzido do nome do tipo de sancao. Multa entra aqui de proposito: e sancao pecuniaria e nao restringe o direito de contratar.`,
      "Ler o registro individual no CEIS (categoria, fundamentacao, abrangencia, situacao e processo) antes de qualquer divulgacao com nome de empresa.",
      "sancoes.json",
      { verification: {
        estado: "requer_revisao_humana",
        metodo: "classificacao_por_tipo_e_fundamentacao",
        confianca: "baixa",
        evidencias: [`${revisaoManual.length} registro(s) sem alcance determinado`],
        limitacoes: [
          "A abrangencia oficial nao e coletada hoje — o alcance e inferido de tipo e fundamentacao",
          "Sem numero de processo e link individual, a conferencia depende de busca manual no CEIS",
        ],
      } },
    );
  }
} else if (chunks.sancoes?.verificados > 0) {
  add(
    "ok",
    "sancoes-verificadas",
    "Fornecedores verificados no CEIS/CNEP",
    `${chunks.sancoes.verificados} fornecedores/contratados verificados; nenhuma sancao vigente localizada (cobertura limitada ao metodo por nome — nao e prova de ausencia).`,
    "Manter a verificacao na rotina da coleta.",
    "sancoes.json",
  );
}

// --- Homologações simbólicas (R$ 0,01 etc.) ---
// Modelo de exploração comercial é legal; o alerta existe porque o valor
// real do negócio (receita de bar/camarote/patrocínio) fica nos anexos do
// edital, invisível ao cidadão que só vê o preço homologado.
const simbolicas = chunks.licitacoesResultados?.homologacoes_simbolicas || [];
if (simbolicas.length) {
  add(
    "warning",
    "homologacao-simbolica",
    "Valor homologado muito abaixo da estimativa",
    `${simbolicas.length} licitacao(oes) apresentam valor homologado muito abaixo da estimativa. Exemplos: ${simbolicas.slice(0, 3).map((s) => `${s.objeto.slice(0, 60)} → ${s.vencedor} por R$ ${Number(s.valor_homologado).toFixed(2)} (estimado R$ ${(Number(s.valor_estimado) / 1000).toFixed(0)} mil)`).join("; ")}. Isso pode decorrer do modelo de exploracao comercial, em que as contrapartidas do edital representam o valor economico principal; o numero isolado nao mede sozinho o negocio.`,
    "Solicitar a integra do edital e anexos (contrapartidas, receitas de exploracao comercial) e o contrato assinado via LAI.",
    "licitacoes_resultados.json",
  );
}

// --- TSE: doador de campanha que é fornecedor/sócio ---
if (chunks.tseDoacoes?.cruzamentos_encontrados > 0) {
  add(
    "warning",
    "doador-fornecedor",
    "Doador de campanha com vinculo em fornecedor do municipio",
    `${chunks.tseDoacoes.cruzamentos_encontrados} cruzamento(s) entre doadores declarados (TSE 2024) e fornecedores/socios da base. Doacao e legal e publica; o vinculo e informativo e pede conferencia humana antes de qualquer divulgacao.`,
    "Conferir os detalhes em tse_doacoes.json e validar CPF/CNPJ antes de publicar.",
    "tse_doacoes.json",
    { verification: {
      estado: "indicio_a_verificar",
      metodo: "doador_tse_x_fornecedor_ou_socio",
      confianca: "media",
      evidencias: [`${chunks.tseDoacoes.cruzamentos_encontrados} correspondencia(s) automatica(s)`],
      limitacoes: ["Doacao eleitoral e atividade legal", "Validar CPF ou CNPJ antes de divulgar"],
    } },
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

for (const [name, label, value] of domainConfig) {
  if (value === undefined) {
    add("error", `chunk-${name}-ausente`, `${label} sem chunk`, `O arquivo ${name}.json esta ausente; isso indica falha, nao zero de registros.`, "Restaurar ou executar somente a etapa responsavel antes da publicacao.", `${name}.json`);
  }
}

function latestSnapshot() {
  const dir = path.join(painelDir, "data", "snapshots");
  if (!fs.existsSync(dir)) return undefined;
  const latest = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort().at(-1);
  if (!latest) return undefined;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, latest), "utf8"));
  } catch {
    return undefined;
  }
}

function checkUnexpectedDrop(id, label, current, previous, source) {
  if (!Number.isFinite(previous) || previous < 10 || !Number.isFinite(current)) return;
  const ratio = current / previous;
  if (ratio > 0.2) return;
  const zeroDetail = current === 0
    ? "A coleta retornou zero; trate como possivel erro ate confirmacao da fonte, nao como ausencia real."
    : `A quantidade caiu ${(100 * (1 - ratio)).toFixed(1)}%.`;
  add("error", id, `Queda anormal em ${label}`, `${zeroDetail} Atual: ${current}; snapshot anterior: ${previous}.`, "Interromper a publicacao e comparar os logs/metadados da etapa com a fonte oficial.", source);
}

const previousSnapshot = latestSnapshot();
if (previousSnapshot?.totais) {
  const currentContracts = (chunks.prefeitura?.contratos?.length || 0) + (chunks.camaraBetha?.contratos?.length || 0);
  const currentSuppliers = (chunks.prefeitura?.top_fornecedores_atual?.length || 0) + (chunks.camaraBetha?.top_fornecedores_atual?.length || 0);
  checkUnexpectedDrop("contratos-queda-anormal", "contratos", currentContracts, Number(previousSnapshot.totais.contratos_qtd), "prefeitura.json + camara_betha.json");
  checkUnexpectedDrop("fornecedores-queda-anormal", "fornecedores", currentSuppliers, Number(previousSnapshot.totais.fornecedores_qtd), "prefeitura.json + camara_betha.json");
}

function latestDateFrom(items, field = "data") {
  return (items || [])
    .map((item) => parseDate(item?.[field]))
    .filter(Boolean)
    .sort((a, b) => b - a)[0];
}

function dateKey(date) {
  return date ? date.toISOString().slice(0, 10) : undefined;
}

// O coletor principal e os enriquecedores estruturados são etapas distintas.
// Comparar as datas impede que o pipeline pareça saudável enquanto o feed/WhatsApp
// continua preso a uma versão antiga da Câmara ou do Diário.
const currentYear = String(new Date().getFullYear());
const latestCamaraSource = latestDateFrom(chunks.camaraAnos?.[currentYear]?.materias);
const latestCamaraStructured = latestDateFrom(chunks.publicacoesCamara?.publicacoes);
const latestCamaraSourceKey = dateKey(latestCamaraSource);
const latestCamaraStructuredKey = dateKey(latestCamaraStructured);
if (latestCamaraSourceKey && (!latestCamaraStructuredKey || latestCamaraStructuredKey < latestCamaraSourceKey)) {
  add(
    "error",
    "publicacoes-camara-defasadas",
    "Publicacoes estruturadas da Camara defasadas",
    `SAPL consolidado chega a ${latestCamaraSourceKey}, mas o feed estruturado chega a ${latestCamaraStructuredKey || "data ausente"}.`,
    "Rodar coletor_publicacoes.py e confirmar que a etapa incremental faz parte do update-data.ps1.",
    "camara_anos.json + publicacoes_estruturadas.json",
  );
}

const latestDiarioStructured = latestDateFrom(chunks.publicacoesDiario?.publicacoes);
const latestDiaryKey = dateKey(latestDiary?.date);
const latestDiarioStructuredKey = dateKey(latestDiarioStructured);
if (latestDiaryKey && (!latestDiarioStructuredKey || latestDiarioStructuredKey < latestDiaryKey)) {
  add(
    "error",
    "publicacoes-diario-defasadas",
    "Publicacoes estruturadas do Diario Oficial defasadas",
    `A lista de edicoes chega a ${latestDiaryKey}, mas o feed estruturado chega a ${latestDiarioStructuredKey || "data ausente"}.`,
    "Rodar coletor_diario.py em modo incremental e conferir os PDFs das edicoes pendentes.",
    "diario.json + publicacoes_diario.json",
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
  issues: items,
};

writeJson(outPath, payload);
writeJson(statusPath, buildSourceStatus());
updateManifest();

const label = level === "critical" ? "CRITICO" : level === "attention" ? "ATENCAO" : "OK";
console.log(`Auditoria de dados: ${label} (${payload.summary.errors} erro(s), ${payload.summary.warnings} aviso(s), ${payload.summary.info} info)`);
for (const item of items.filter((item) => item.severity !== "ok")) {
  console.log(`- [${item.severity}] ${item.title}: ${item.detail}`);
}

// So defeito de pipeline (blocksPipeline !== false) trava a publicacao
// automatica. Achado de conteudo grave (fornecedor sancionado, etc.) segue
// contando como erro na tela/IFT, mas nao impede o ciclo diario de rodar —
// sem isso, todo achado grave (que pode durar meses) travava o site para
// sempre no ultimo backup bom, como ocorreu apos a descoberta da MASTERFER.
const errosQueBloqueiam = items.filter((i) => i.severity === "error" && i.blocksPipeline !== false).length;
if ((strict || !noExitCode) && errosQueBloqueiam > 0) process.exit(1);
