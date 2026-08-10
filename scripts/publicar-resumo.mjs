#!/usr/bin/env node
/**
 * Gera o resumo do período, publica a página no site e avisa o grupo com o link.
 *
 *   node scripts/publicar-resumo.mjs --tipo=semanal          # segunda ate hoje
 *   node scripts/publicar-resumo.mjs --tipo=mensal           # mes fechado anterior
 *   node scripts/publicar-resumo.mjs --tipo=semanal --seco   # nao publica nem envia
 *
 * `--seco` gera o arquivo e imprime a mensagem sem tocar no site nem no grupo.
 * Use antes de qualquer mudança no texto.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { semanaCorrente, mesAnterior, agregarPeriodo } from "./lib/resumo-periodo.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const SITE = "https://www.fiscalizavarginha.com.br";

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1] || "";
const seco = process.argv.includes("--seco");
const tipo = arg("tipo") === "mensal" ? "mensal" : "semanal";

// Guarda de calendário. O agendador do Windows nao tem gatilho mensal via
// Register-ScheduledTask, e passar o comando por schtasks.exe esbarra no
// escape de aspas do PowerShell. Um gatilho diario com esta guarda faz o mesmo
// trabalho e usa o mesmo caminho de codigo do semanal.
const soNoDia = Number(arg("so-no-dia") || 0);
if (soNoDia && new Date().getDate() !== soNoDia) {
  console.log(`Hoje e dia ${new Date().getDate()}; esta tarefa so publica no dia ${soNoDia}. Nada a fazer.`);
  process.exit(0);
}

const readJson = (n) => {
  const p = path.join(root, "painel-cidadao", "data", "chunks", `${n}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : undefined;
};
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso) => iso.split("-").reverse().join("/");

const periodo = tipo === "mensal" ? mesAnterior(new Date()) : semanaCorrente(new Date());
const { inicio, fim } = periodo;

// 1. Gera as duas páginas: trabalho legislativo e compras, em links separados.
const base = tipo === "mensal" ? `resumo-mensal-${inicio.slice(0, 7)}` : `resumo-semanal-${inicio}`;
const secoes = [
  { secao: "legislativo", arquivo: `${base}-legislativo.html` },
  { secao: "compras", arquivo: `${base}-compras.html` },
];
for (const s of secoes) {
  s.local = path.join(root, "painel-cidadao", "relatorios", s.arquivo);
  s.url = `${SITE}/relatorios/${s.arquivo}`;
  const ger = spawnSync("node", [
    path.join(__dirname, "generate-resumo.mjs"),
    `--inicio=${inicio}`, `--fim=${fim}`, `--tipo=${tipo}`,
    `--secao=${s.secao}`, `--saida=${s.local}`,
  ], { cwd: root, encoding: "utf8" });
  if (ger.status !== 0) {
    console.error(ger.stdout, ger.stderr);
    process.exit(1);
  }
  process.stdout.write(ger.stdout);
}

// 2. Monta a mensagem a partir dos números do próprio período.
const r = agregarPeriodo({
  camaraAnos: readJson("camara_anos"),
  prefeitura: readJson("prefeitura"),
  camaraBetha: readJson("camara_betha"),
  publicacoesDiario: readJson("publicacoes_diario"),
  diarias: readJson("diarias"),
}, inicio, fim);

const c = r.compras;
const contratos = c.contratos_prefeitura.length + c.contratos_camara.length;
const valor = c.valor_contratos_prefeitura + c.valor_contratos_camara;
const rotulo = tipo === "mensal" ? "RESUMO MENSAL" : "RESUMO DA SEMANA";

const blocoLegislativo = r.legislativo.materias_de_vereadores > 0
  ? `- ${r.legislativo.materias_de_vereadores} matérias protocoladas por vereadores\n`
    + `- ${r.legislativo.sessoes.length} sessão(ões) no período`
  : `- Nenhuma matéria protocolada por vereador no período\n`
    + `- ${r.legislativo.ausencia?.texto || ""}`
    // A sessão anterior só ajuda a entender quando NÃO houve sessão no período.
    // Se houve, citá-la sugere que a Câmara está parada há mais tempo do que está.
    + (r.legislativo.ausencia?.motivo === "sem_sessao_no_periodo"
       && r.legislativo.ausencia?.sessao_anterior
      ? `\n- Última sessão registrada antes do período: ${dataBr(r.legislativo.ausencia.sessao_anterior)}` : "");

const msg = `📊 *${rotulo} | ${dataBr(inicio)} a ${dataBr(fim)}*
════════════════════════════════════
Câmara e Prefeitura de Varginha

🏛️ *TRABALHO LEGISLATIVO*
${blocoLegislativo}

🧾 *COMPRAS E CONTRATOS*
- ${contratos} contrato(s) assinado(s) (${c.contratos_prefeitura.length} Prefeitura, ${c.contratos_camara.length} Câmara)
- ${brl(valor)} somados nesses contratos
- ${c.contratacao_direta_publicada.length} ato(s) de dispensa e inexigibilidade no Diário, ${brl(c.valor_contratacao_direta)}
- ${c.diarias_prefeitura.length + c.diarias_camara.length} diária(s) autorizada(s), ${brl(c.valor_diarias_prefeitura + c.valor_diarias_camara)}

📄 *TRABALHO DOS VEREADORES*
Ficha de cada vereador, com resumo de cada matéria e link para o documento oficial:
${secoes[0].url}

💰 *COMPRAS E CONTRATAÇÕES*
O que foi comprado, de quem, por qual modalidade:
${secoes[1].url}

ℹ️ Contrato assinado não é pagamento executado. Os valores são de compromissos firmados no período.

🛡️ Painel completo: ${SITE}

#fiscalizacao #varginha #controlecidadao`;

console.log("\n--- mensagem ---\n" + msg + "\n----------------");

if (seco) {
  console.log("\n[--seco] Nada publicado, nada enviado.");
  process.exit(0);
}

// 3. Publica as duas páginas (arquivo a arquivo, sem tocar no resto do site).
for (const s of secoes) {
  const dep = spawnSync("python", [
    path.join(root, "private", "deploy_arquivo.py"), s.local, `relatorios/${s.arquivo}`,
  ], { cwd: root, encoding: "utf8" });
  process.stdout.write(dep.stdout || "");
  if (dep.status !== 0) {
    console.error("Deploy falhou; nada foi enviado ao grupo.", dep.stderr);
    process.exit(1);
  }
}

// 4. Só avisa o grupo depois que AS DUAS páginas responderem no ar. Divulgar um
// par de links com um quebrado e pior que nao divulgar.
for (const s of secoes) {
  const check = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", s.url], { encoding: "utf8" });
  if (check.stdout.trim() !== "200") {
    console.error(`${s.url} respondeu ${check.stdout.trim()} — mensagem nao enviada.`);
    process.exit(1);
  }
}

const env = spawnSync("python", ["-c", `
import sys; sys.path.insert(0, r"${path.join(root, "painel-cidadao")}")
sys.stdout.reconfigure(encoding="utf-8")
from alertar_whatsapp import carregar_config, enviar_mensagem
msg = sys.stdin.read()
print("ENVIADO" if enviar_mensagem(carregar_config(), msg) else "FALHOU")
`], { input: msg, encoding: "utf8", cwd: root });
process.stdout.write(env.stdout || "");
if (!String(env.stdout).includes("ENVIADO")) {
  console.error("Envio ao grupo falhou.", env.stderr);
  process.exit(1);
}
console.log(`\nPublicado: ${url}`);
