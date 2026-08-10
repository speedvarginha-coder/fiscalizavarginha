// Card de matéria legislativa: chips, resumo, por que acompanhar, pontos de
// atenção e links. O conteúdo textual vem de publicacoes_estruturadas.json,
// produzido pelo enriquecedor — este módulo só monta o HTML, não escreve texto.

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dataBr = (iso) => String(iso || "").slice(0, 10).split("-").reverse().join("/");
const RELEVO = { alto: "alta", medio: "média", baixo: "baixa" };

/**
 * Indexa as publicações estruturadas por "numero/ano" + tipo, para casar com
 * as matérias do bloco anual (que trazem sigla, impacto_zero e desfecho).
 */
export function indexarPublicacoes(publicacoes) {
  const idx = new Map();
  for (const p of publicacoes || []) {
    const chave = `${String(p.numero || "").trim()}|${String(p.tipo_label || "").toUpperCase()}`;
    if (chave.length > 1) idx.set(chave, p);
  }
  return idx;
}

/** Recupera a publicação estruturada correspondente a uma matéria. */
export function publicacaoDe(materia, idx) {
  return idx.get(`${materia.numero}/${materia.ano}|${String(materia.tipo || "").toUpperCase()}`) || null;
}

export function cardMateria(materia, pub) {
  const rel = String(pub?.interesse_publico || materia.grau || "").toLowerCase();
  const links = pub?.links || {};
  const porque = (pub?.por_que_acompanhar || []).slice(0, 3);
  const pontos = (pub?.pontos_atencao || []).slice(0, 2);
  const tema = pub?.tema || materia.tema_label || "";
  const titulo = pub?.titulo || `${materia.tipo} nº ${materia.numero}/${materia.ano}`;
  const texto = pub?.resumo || materia.ementa || "";

  return `
          <article class="materia">
            <div class="materia-topo">
              <div class="chips">
                <span class="chip chip-tipo">${esc(materia.sigla || "")} ${esc(materia.numero)}/${esc(materia.ano)}</span>
                ${tema ? `<span class="chip">${esc(tema.charAt(0).toUpperCase() + tema.slice(1))}</span>` : ""}
                ${rel ? `<span class="chip chip-${esc(rel)}">Relevância ${esc(RELEVO[rel] || rel)}</span>` : ""}
                ${materia.impacto_zero ? '<span class="chip chip-zero">Sem impacto orçamentário</span>' : ""}
                ${materia.desfecho === "lei" ? '<span class="chip chip-lei">Virou lei</span>' : ""}
              </div>
              <time datetime="${esc(String(materia.data).slice(0, 10))}">${dataBr(materia.data)}</time>
            </div>

            <h4>${esc(titulo)}</h4>
            <p class="resumo"><b>Resumo:</b> ${esc(texto)}</p>

            ${porque.length ? `<div class="acompanhar">
              <b>Por que acompanhar</b>
              <ul>${porque.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
            </div>` : ""}

            ${pontos.length ? `<div class="atencao">
              <b>Pontos de atenção</b>
              <ul>${pontos.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
            </div>` : ""}

            ${links.inteiro_teor || links.consulta ? `<div class="acoes">
              ${links.inteiro_teor ? `<a class="botao" href="${esc(links.inteiro_teor)}" target="_blank" rel="noopener">Ver documento no detalhe</a>` : ""}
              ${links.consulta ? `<a class="botao secundario" href="${esc(links.consulta)}" target="_blank" rel="noopener">Tramitação no SAPL</a>` : ""}
            </div>` : ""}
          </article>`;
}

/** Ficha de um vereador com todas as suas matérias do período. */
export function fichaVereador(vereador, idx) {
  const tipos = vereador.itens.reduce((acc, m) => {
    const k = m.tipo || "Matéria";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const linha = Object.entries(tipos).map(([t, n]) => `${n} ${t.toLowerCase()}`).join(", ");
  const altos = vereador.itens.filter((m) => {
    const p = publicacaoDe(m, idx);
    return (p?.interesse_publico || m.grau) === "alto";
  }).length;

  const cards = [...vereador.itens]
    .sort((a, b) => String(a.data).localeCompare(String(b.data)))
    .map((m) => cardMateria(m, publicacaoDe(m, idx)))
    .join("");

  return `
      <article class="ficha">
        <header>
          <h3>${esc(vereador.nome)}</h3>
          <div class="linha-resumo">${vereador.total} matéria(s) · ${esc(linha)}${
            altos ? ` · ${altos} de relevância alta` : ""}</div>
        </header>
        <div class="materias">${cards}</div>
      </article>`;
}
