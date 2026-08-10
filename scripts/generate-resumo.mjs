#!/usr/bin/env node
/**
 * Resumo de período — Câmara e Prefeitura, trabalho legislativo e compras.
 *
 *   node scripts/generate-resumo.mjs                      # semana fechada anterior
 *   node scripts/generate-resumo.mjs --tipo=mensal        # mês fechado anterior
 *   node scripts/generate-resumo.mjs --inicio=2026-07-01 --fim=2026-07-31
 *   node scripts/generate-resumo.mjs --saida=caminho.html
 *
 * O bloco de compras sai sempre. O bloco legislativo, quando não houver
 * matéria, explica a ausência com fatos da base — sessão anterior e próxima —
 * em vez de aparecer vazio como se fosse falha de coleta.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { semanaAnterior, mesAnterior, agregarPeriodo } from "./lib/resumo-periodo.mjs";
import { indexarPublicacoes, fichaVereador } from "./lib/render-materia.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const chunksDir = path.join(root, "painel-cidadao", "data", "chunks");

const arg = (nome) => {
  const hit = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return hit ? hit.split("=", 2)[1].trim() : "";
};

function readJson(nome) {
  const p = path.join(chunksDir, `${nome}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : undefined;
}

const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Qual bloco entra na pagina. Separar permite dois links no post: um do
// trabalho legislativo, outro das compras — cada publico acessa o que quer.
const secao = ["legislativo", "compras"].includes(arg("secao")) ? arg("secao") : "tudo";

function periodoEscolhido() {
  const inicio = arg("inicio");
  const fim = arg("fim");
  if (inicio && fim) return { inicio, fim, tipo: arg("tipo") || "personalizado" };
  return arg("tipo") === "mensal" ? mesAnterior(new Date()) : semanaAnterior(new Date());
}

function blocoLegislativo(leg, tipo, idx) {
  if (leg.materias_de_vereadores > 0) {
    const linhas = leg.ranking.map((v) => `
      <tr>
        <td class="nome">${esc(v.nome)}</td>
        <td class="obj">${Object.entries(v.tipos).map(([t, n]) => `${n} ${esc(t)}`).join(", ")}</td>
        <td class="num forte">${v.total}</td>
      </tr>`).join("");
    return `
    <section>
      <h2>Trabalho legislativo</h2>
      <p class="nota">${leg.materias_de_vereadores} matéria(s) de autoria de vereadores${
        leg.materias_total > leg.materias_de_vereadores
          ? `, além de ${leg.materias_total - leg.materias_de_vereadores} do Executivo, da Mesa ou de comissões`
          : ""}. ${leg.sessoes.length} sessão(ões) no período.</p>
      <div class="rolagem"><table>
        <thead><tr><th>Vereador</th><th>Tipos</th><th class="num">Total</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table></div>
    </section>
    <section>
      <h2>Detalhamento por vereador</h2>
      <p class="nota">Cada matéria com resumo, motivos para acompanhar, pontos de atenção e
      link para o documento e para a tramitação no SAPL. Resumo e motivos vêm do enriquecimento
      automático da base — o texto oficial é sempre o do documento.</p>
      <div class="fichas">${leg.ranking.map((v) => fichaVereador(v, idx)).join("")}</div>
    </section>`;
  }

  const a = leg.ausencia || {};
  const contexto = [
    a.sessao_anterior ? `A última sessão registrada antes do período foi em ${dataBr(a.sessao_anterior)}.` : "",
    a.sessao_posterior ? `A sessão seguinte ocorreu em ${dataBr(a.sessao_posterior)}.` : "",
  ].filter(Boolean).join(" ");

  return `
    <section>
      <h2>Trabalho legislativo</h2>
      <div class="vazio">
        <p class="destaque-texto">Nenhuma matéria foi protocolada por vereador ${
          tipo === "mensal" ? "neste mês" : "nesta semana"}.</p>
        <p class="nota">${esc(a.texto || "Sem registro de atividade no período.")} ${esc(contexto)}</p>
        <p class="nota">Ausência de matéria não é falha de coleta: a base do SAPL foi consultada e não há
        protocolo no intervalo. O calendário de sessões da Câmara concentra a atividade em períodos
        determinados, e intervalos sem sessão produzem semanas sem protocolo.</p>
      </div>
    </section>`;
}

function blocoCompras(c) {
  const modalidades = Object.entries(c.por_modalidade)
    .sort((a, b) => b[1].valor - a[1].valor)
    .map(([nome, o]) => `<tr><td>${esc(nome)}</td><td class="num">${o.qtd}</td><td class="num forte">${brl(o.valor)}</td></tr>`)
    .join("");

  const maiores = [...c.contratos_prefeitura, ...c.contratos_camara]
    .sort((a, b) => (Number(b.valor) || 0) - (Number(a.valor) || 0))
    .slice(0, 8)
    .map((k) => `
      <tr>
        <td class="nome">${esc(k.contratado || "(sem contratado)")}</td>
        <td class="obj">${esc(String(k.objeto || "").slice(0, 110))}</td>
        <td class="obj">${esc(k.modalidade || "")}</td>
        <td class="num forte">${brl(k.valor)}</td>
      </tr>`).join("");

  const diretas = c.contratacao_direta_publicada
    .sort((a, b) => (Number(b?.valores?.total) || 0) - (Number(a?.valores?.total) || 0))
    .map((p) => `<tr><td>${esc(String(p.titulo || "").slice(0, 90))}</td><td class="obj">${esc(p.tipo)}</td><td class="num forte">${brl(p?.valores?.total)}</td></tr>`)
    .join("");

  return `
    <section>
      <h2>Compras e contratos</h2>
      <p class="nota">Contratos assinados e atos de contratação direta publicados no período.
      São compromissos firmados, não pagamentos executados.</p>

      ${modalidades ? `<h3 class="sub-h">Como a Prefeitura contratou</h3>
      <div class="rolagem"><table>
        <thead><tr><th>Modalidade</th><th class="num">Contratos</th><th class="num">Valor</th></tr></thead>
        <tbody>${modalidades}</tbody>
      </table></div>` : '<p class="nota">Nenhum contrato da Prefeitura assinado no período.</p>'}

      ${maiores ? `<h3 class="sub-h">Maiores contratos</h3>
      <div class="rolagem"><table>
        <thead><tr><th>Contratado</th><th>Objeto</th><th>Modalidade</th><th class="num">Valor</th></tr></thead>
        <tbody>${maiores}</tbody>
      </table></div>` : ""}

      ${c.diarias_prefeitura.length || c.diarias_camara.length ? `<h3 class="sub-h">Diárias autorizadas</h3>
      <div class="rolagem"><table>
        <thead><tr><th>Órgão</th><th class="num">Diárias</th><th class="num">Valor</th></tr></thead>
        <tbody>
          <tr><td>Prefeitura</td><td class="num">${c.diarias_prefeitura.length}</td><td class="num forte">${brl(c.valor_diarias_prefeitura)}</td></tr>
          <tr><td>Câmara</td><td class="num">${c.diarias_camara.length}</td><td class="num forte">${brl(c.valor_diarias_camara)}</td></tr>
        </tbody>
      </table></div>
      <p class="nota">Contadas pela data inicial da viagem. Diária autorizada não é
      necessariamente diária paga nem viagem realizada.</p>` : ""}

      ${diretas ? `<h3 class="sub-h">Contratação direta publicada no Diário</h3>
      <div class="rolagem"><table>
        <thead><tr><th>Ato</th><th>Tipo</th><th class="num">Valor</th></tr></thead>
        <tbody>${diretas}</tbody>
      </table></div>` : ""}
    </section>`;
}

function render(r, tipo, idx) {
  const { inicio, fim } = r.periodo;
  const c = r.compras;
  const totalContratos = c.contratos_prefeitura.length + c.contratos_camara.length;
  const rotulo = tipo === "mensal" ? "Resumo mensal" : "Resumo semanal";
  const sufixo = secao === "legislativo" ? " · Trabalho legislativo"
    : secao === "compras" ? " · Compras e contratações" : "";
  const css = fs.readFileSync(path.join(__dirname, "lib", "resumo.css"), "utf8");

  return `<title>${rotulo}${sufixo} — Varginha, ${dataBr(inicio)} a ${dataBr(fim)}</title>
<style>${css}</style>
<div class="wrap">
  <header class="masthead">
    <div class="eyebrow">Fiscaliza Varginha · ${rotulo}${sufixo}</div>
    <h1>Câmara e Prefeitura de Varginha</h1>
    <div class="periodo">${dataBr(inicio)} a ${dataBr(fim)}</div>
    <div class="proveniencia">
      <span>Fontes: SAPL, Portal Betha e Diário Oficial</span>
      <span>Gerado em ${new Date().toLocaleDateString("pt-BR")}</span>
    </div>
  </header>

  <div class="numeros">
    ${secao === "compras" ? "" : `<div class="numero"><b>${r.legislativo.materias_de_vereadores}</b><span>matérias de vereadores</span></div>
    <div class="numero"><b>${r.legislativo.sessoes.length}</b><span>sessões no período</span></div>`}
    ${secao === "legislativo" ? "" : `<div class="numero"><b>${totalContratos}</b><span>contratos assinados</span></div>`}
    <div class="numero"><b>${brl(c.valor_contratos_prefeitura + c.valor_contratos_camara)}</b><span>somados nesses contratos</span></div>
    <div class="numero"><b>${c.contratacao_direta_publicada.length}</b><span>atos de contratação direta</span></div>
  </div>

  ${secao === "compras" ? "" : blocoLegislativo(r.legislativo, tipo, idx)}
  ${secao === "legislativo" ? "" : blocoCompras(c)}

  <footer>
    <p><b>O que este resumo não afirma.</b> Contrato assinado não é pagamento executado —
    a base não tem série de empenho e liquidação por período. O CNPJ dos fornecedores vem
    mascarado na origem, então o cruzamento com sanções e quadro societário funciona por raiz
    e pode deixar casos sem vínculo.</p>
    <p>Divergência entre este resumo e o portal de origem deve ser resolvida a favor da fonte oficial.</p>
  </footer>
</div>
`;
}

const { inicio, fim, tipo } = periodoEscolhido();
const chunks = {
  camaraAnos: readJson("camara_anos"),
  prefeitura: readJson("prefeitura"),
  camaraBetha: readJson("camara_betha"),
  publicacoesDiario: readJson("publicacoes_diario"),
  diarias: readJson("diarias"),
};
const resumo = agregarPeriodo(chunks, inicio, fim);
const idx = indexarPublicacoes(readJson("publicacoes_estruturadas")?.publicacoes);
// Templates condicionais podem deixar linhas contendo apenas indentacao.
// Normalizar a saida mantem os relatorios deterministas e o diff limpo.
const html = render(resumo, tipo, idx).replace(/[ \t]+$/gm, "");
const saida = arg("saida") || path.join(root, "painel-cidadao", "relatorios", `resumo-${tipo}${secao === "tudo" ? "" : "-" + secao}-${inicio}.html`);
fs.mkdirSync(path.dirname(saida), { recursive: true });
fs.writeFileSync(saida, html, "utf8");

console.log(`${tipo}: ${inicio} a ${fim}`);
console.log(`  legislativo: ${resumo.legislativo.materias_de_vereadores} matéria(s) de vereador, ${resumo.legislativo.sessoes.length} sessão(ões)`);
if (resumo.legislativo.ausencia) console.log(`  ausência: ${resumo.legislativo.ausencia.motivo}`);
console.log(`  compras: ${resumo.compras.contratos_prefeitura.length + resumo.compras.contratos_camara.length} contrato(s), ${brl(resumo.compras.valor_contratos_prefeitura + resumo.compras.valor_contratos_camara)}`);
console.log(`  → ${path.relative(root, saida)}`);
