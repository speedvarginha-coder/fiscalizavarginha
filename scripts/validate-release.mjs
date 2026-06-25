import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const painelDir = path.join(root, "painel-cidadao");
const chunksDir = path.join(painelDir, "data", "chunks");
const manifestPath = path.join(painelDir, "data", "manifest.json");
const stageDir = path.join(root, "dist", "painel-cidadao");
const zipPath = path.join(root, "dist", "fiscaliza-varginha-painel.zip");

const expectedChunks = [
  "atualizacoes",
  "atualizado_em",
  "auditoria_dados",
  "camara_anos",
  "camara_betha",
  "camara_transparencia",
  "cnpjs",
  "convenios",
  "diarias",
  "diario",
  "educacao",
  "emendas",
  "federal",
  "fontes_emendas_2026",
  "indice_relevancia",
  "licitacoes",
  "mudancas_coleta",
  "obras_educacao",
  "pessoal",
  "pncp",
  "prefeitura",
  "publicacoes_diario",
  "publicacoes_estruturadas",
  "receitas",
  "remuneracao_vereadores",
  "resumo",
  "sancoes_fornecedores",
  "vereadores",
];

const requiredPublicFiles = [
  ".htaccess",
  "app-glossario.js",
  "app.js",
  "atualizacoes.html",
  "camara.html",
  "cobrar.html",
  "data-loader.js",
  "data.js",
  "favicon.svg",
  "index.html",
  "marcadores.html",
  "pessoal.html",
  "prefeitura.html",
  "relatorios.html",
  "sobre.html",
  "style.css",
  "sw.js",
  "modules/utils.js",
  "modules/icons.js",
  "modules/glossario.js",
  "modules/categorias.js",
  "modules/watchlist.js",
  "modules/dossie.js",
  "modules/dashboard.js",
  "modules/home-cidadao.js",
  "modules/relatorios.js",
  "modules/diarias.js",
  "modules/atualizacoes.js",
  "modules/materia-cidada.js",
  "modules/indice-relevancia.js",
  "modules/onboarding.js",
  "modules/chat-cidadao.js",
  "data/manifest.json",
  ...expectedChunks.map((name) => `data/chunks/${name}.json`),
];

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`JSON invalido: ${path.relative(root, filePath)} (${error.message})`);
    return undefined;
  }
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertArray(value, label, min = 0) {
  assert(Array.isArray(value), `${label} deve ser array`);
  if (Array.isArray(value)) {
    assert(value.length >= min, `${label} deve ter pelo menos ${min} item(ns)`);
  }
}

function assertObject(value, label) {
  assert(isObject(value), `${label} deve ser objeto`);
}

function assertNumber(value, label, min = Number.NEGATIVE_INFINITY) {
  assert(typeof value === "number" && Number.isFinite(value), `${label} deve ser numero finito`);
  if (typeof value === "number" && Number.isFinite(value)) {
    assert(value >= min, `${label} deve ser >= ${min}`);
  }
}

function relative(filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function loadChunks(baseChunksDir = chunksDir) {
  const chunks = new Map();
  for (const name of expectedChunks) {
    const filePath = path.join(baseChunksDir, `${name}.json`);
    if (!exists(filePath)) {
      fail(`Chunk ausente: ${relative(filePath)}`);
      continue;
    }
    const parsed = readJson(filePath);
    if (parsed !== undefined) chunks.set(name, parsed);
  }
  return chunks;
}

function validateManifest(baseManifestPath = manifestPath, baseChunksDir = chunksDir) {
  if (!exists(baseManifestPath)) {
    fail(`Manifest ausente: ${relative(baseManifestPath)}`);
    return;
  }

  const manifest = readJson(baseManifestPath);
  if (!manifest) return;

  assertObject(manifest.chunks, "manifest.chunks");
  if (!isObject(manifest.chunks)) return;

  const manifestNames = Object.keys(manifest.chunks).sort();
  const expectedSorted = [...expectedChunks].sort();

  for (const name of expectedSorted) {
    assert(manifestNames.includes(name), `Manifest nao lista chunk: ${name}`);
  }

  for (const name of manifestNames) {
    if (!expectedChunks.includes(name)) {
      warn(`Manifest lista chunk nao esperado: ${name}`);
    }
  }

  for (const name of expectedChunks) {
    const entry = manifest.chunks[name];
    if (!isObject(entry)) continue;
    const expectedFile = `data/chunks/${name}.json`;
    assert(entry.arquivo === expectedFile, `Manifest aponta caminho incorreto para ${name}`);

    const filePath = path.join(baseChunksDir, `${name}.json`);
    if (exists(filePath)) {
      const size = fs.statSync(filePath).size;
      assert(entry.bytes === size, `Manifest bytes divergente em ${name}: ${entry.bytes} != ${size}`);
      assert(size > 0, `Chunk vazio: ${relative(filePath)}`);
    }
  }
}

function validateFreshness(chunks) {
  const atualizado = chunks.get("atualizado_em");
  assertObject(atualizado, "atualizado_em");
  if (!isObject(atualizado)) return;

  assert(typeof atualizado.iso === "string", "atualizado_em.iso deve ser string");
  const date = new Date(atualizado.iso);
  assert(!Number.isNaN(date.getTime()), "atualizado_em.iso deve ser data valida");
  if (Number.isNaN(date.getTime())) return;

  const ageMs = Date.now() - date.getTime();
  const ageDays = ageMs / 86_400_000;
  assert(ageDays <= 30, `Dados antigos: ultima coleta ha ${ageDays.toFixed(1)} dias`);
  assert(ageDays >= -1, "Data de coleta esta mais de 1 dia no futuro");
}

function validateDomainShapes(chunks) {
  const prefeitura = chunks.get("prefeitura");
  assertObject(prefeitura, "prefeitura");
  if (isObject(prefeitura)) {
    assertNumber(prefeitura.ano_atual, "prefeitura.ano_atual", 2020);
    assertNumber(prefeitura.total_externo_atual, "prefeitura.total_externo_atual", 0);
    assertArray(prefeitura.contratos, "prefeitura.contratos", 1);
    assertArray(prefeitura.top_fornecedores_atual, "prefeitura.top_fornecedores_atual");
  }

  const camaraBetha = chunks.get("camara_betha");
  assertObject(camaraBetha, "camara_betha");
  if (isObject(camaraBetha)) {
    assertNumber(camaraBetha.ano_atual, "camara_betha.ano_atual", 2020);
    assertArray(camaraBetha.contratos, "camara_betha.contratos", 1);
  }

  const diarias = chunks.get("diarias");
  assertObject(diarias, "diarias");
  if (isObject(diarias)) {
    assertArray(diarias.anos, "diarias.anos", 1);
    assertArray(diarias.prefeitura, "diarias.prefeitura");
    assertArray(diarias.camara, "diarias.camara");
    assertObject(diarias.resumo, "diarias.resumo");
  }

  const pessoal = chunks.get("pessoal");
  assertObject(pessoal, "pessoal");
  if (isObject(pessoal)) {
    assertObject(pessoal.camara, "pessoal.camara");
    assertObject(pessoal.prefeitura, "pessoal.prefeitura");
    if (isObject(pessoal.camara)) assertArray(pessoal.camara.servidores, "pessoal.camara.servidores", 1);
    if (isObject(pessoal.prefeitura)) assertObject(pessoal.prefeitura.resumo, "pessoal.prefeitura.resumo");
  }

  const emendas = chunks.get("emendas");
  assertArray(emendas, "emendas", 1);
  if (Array.isArray(emendas) && emendas[0]) {
    assert(typeof emendas[0].numero !== "undefined", "emendas[0].numero deve existir");
    assert(typeof emendas[0].valor_brl !== "undefined", "emendas[0].valor_brl deve existir");
  }

  const vereadores = chunks.get("vereadores");
  assertArray(vereadores, "vereadores", 10);
  if (Array.isArray(vereadores)) {
    assert(vereadores.every((v) => isObject(v) && typeof v.nome === "string"), "vereadores devem ter nome");
  }

  const remuneracao = chunks.get("remuneracao_vereadores");
  assertObject(remuneracao, "remuneracao_vereadores");
  if (isObject(remuneracao)) {
    assertObject(remuneracao.lei, "remuneracao_vereadores.lei");
    assertNumber(remuneracao.subsidio_bruto_mensal_brl, "remuneracao_vereadores.subsidio_bruto_mensal_brl", 1);
    assertNumber(remuneracao.quantidade_lei, "remuneracao_vereadores.quantidade_lei", 1);
    assertNumber(remuneracao.impacto_mensal_estimado_brl, "remuneracao_vereadores.impacto_mensal_estimado_brl", 1);
    assertNumber(remuneracao.impacto_anual_estimado_brl, "remuneracao_vereadores.impacto_anual_estimado_brl", 1);
    if (isObject(remuneracao.lei)) {
      assert(typeof remuneracao.lei.url === "string" && /^https?:\/\//.test(remuneracao.lei.url), "remuneracao_vereadores.lei.url deve ser URL oficial");
    }
  }

  const indice = chunks.get("indice_relevancia");
  assertObject(indice, "indice_relevancia");
  if (isObject(indice)) {
    assertObject(indice.metodologia, "indice_relevancia.metodologia");
    assertObject(indice.anos, "indice_relevancia.anos");
    if (isObject(indice.anos)) {
      for (const [ano, bloco] of Object.entries(indice.anos)) {
        assertObject(bloco, `indice_relevancia.anos.${ano}`);
        if (isObject(bloco)) {
          assertArray(bloco.ranking, `indice_relevancia.anos.${ano}.ranking`, 1);
          assertNumber(bloco.cobertura_pct, `indice_relevancia.anos.${ano}.cobertura_pct`, 0);
        }
      }
    }
  }

  const resumo = chunks.get("resumo");
  assertObject(resumo, "resumo");
  if (isObject(resumo)) {
    assertNumber(resumo.ano, "resumo.ano", 2020);
    assertNumber(resumo.total_materias, "resumo.total_materias", 0);
  }

  // Validações leves para novos chunks grandes
  const pubDiario = chunks.get("publicacoes_diario");
  if (pubDiario !== undefined) {
    assert(
      isObject(pubDiario) || Array.isArray(pubDiario),
      "publicacoes_diario deve ser objeto ou array",
    );
    if (isObject(pubDiario)) {
      assertArray(pubDiario.publicacoes, "publicacoes_diario.publicacoes");
    }
  }

  const pubEstruturadas = chunks.get("publicacoes_estruturadas");
  if (pubEstruturadas !== undefined) {
    assert(
      isObject(pubEstruturadas) || Array.isArray(pubEstruturadas),
      "publicacoes_estruturadas deve ser objeto ou array",
    );
  }
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function validateData() {
  validateManifest();
  const chunks = loadChunks();
  validateFreshness(chunks);
  validateDomainShapes(chunks);
}

function validateDeploy() {
  assert(exists(stageDir), `Pasta de deploy nao encontrada: ${relative(stageDir)}`);
  assert(exists(zipPath), `Zip de deploy nao encontrado: ${relative(zipPath)}`);
  if (exists(zipPath)) {
    assert(fs.statSync(zipPath).size > 0, "Zip de deploy esta vazio");
  }

  if (!exists(stageDir)) return;

  for (const file of requiredPublicFiles) {
    assert(exists(path.join(stageDir, file)), `Arquivo publico ausente no pacote: ${file}`);
  }

  const files = walk(stageDir);
  const forbiddenExtensions = new Set([".py", ".pyc", ".bat", ".txt", ".log", ".bak", ".backup", ".tmp"]);
  const forbiddenDirs = new Set(["private", "node_modules", "tests", "docs", "__pycache__", ".git"]);

  for (const file of files) {
    const rel = path.relative(stageDir, file).replace(/\\/g, "/");
    const parts = rel.split("/");
    const ext = path.extname(file).toLowerCase();

    if (forbiddenExtensions.has(ext)) fail(`Arquivo proibido no pacote: ${rel}`);
    if (parts.some((part) => forbiddenDirs.has(part))) fail(`Diretorio proibido no pacote: ${rel}`);
    if (path.basename(file).startsWith(".betha-token")) fail(`Token Betha no pacote: ${rel}`);

    if (rel.startsWith("data/") && ext === ".json") {
      const allowed = rel === "data/manifest.json" || /^data\/chunks\/[^/]+\.json$/.test(rel) || /^data\/snapshots\/[^/]+\.json$/.test(rel);
      if (!allowed) fail(`JSON intermediario no pacote: ${rel}`);
    }
  }

  const htaccessPath = path.join(stageDir, ".htaccess");
  if (exists(htaccessPath)) {
    const htaccess = fs.readFileSync(htaccessPath, "utf8");
    assert(htaccess.includes("RewriteRule ^data/"), ".htaccess deve bloquear JSONs intermediarios em data/");
    assert(htaccess.includes("chunks/[^/]+\\.json"), ".htaccess deve liberar chunks JSON publicos");
    assert(htaccess.includes("snapshots/[^/]+\\.json"), ".htaccess deve liberar snapshots JSON publicos");
  }

  validateManifest(path.join(stageDir, "data", "manifest.json"), path.join(stageDir, "data", "chunks"));
  loadChunks(path.join(stageDir, "data", "chunks"));
}

function printResult(label) {
  for (const message of warnings) console.warn(`WARN: ${message}`);
  if (failures.length) {
    console.error(`\n${label}: FALHOU`);
    for (const message of failures) console.error(`- ${message}`);
    process.exit(1);
  }
  console.log(`${label}: OK`);
}

const mode = process.argv[2] || "data";

if (mode === "data") {
  validateData();
  printResult("Validacao de dados");
} else if (mode === "deploy") {
  validateDeploy();
  printResult("Validacao do pacote de deploy");
} else if (mode === "all") {
  validateData();
  validateDeploy();
  printResult("Validacao completa");
} else {
  console.error("Uso: node scripts/validate-release.mjs [data|deploy|all]");
  process.exit(1);
}
