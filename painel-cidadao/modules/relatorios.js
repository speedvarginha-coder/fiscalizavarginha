/* Fiscaliza Varginha — modules/relatorios.js
 *
 * Blocos auto-contidos da página de Relatórios:
 *   - Timeline de sinais (eventos cronológicos)
 *   - Detector de fragmentação (contratos suspeitos)
 *   - Comparativo entre anos por categoria
 *
 * Cada função lê window.ZELA_DATA diretamente. Só renderiza se o
 * elemento alvo existe no DOM (ignora outras páginas).
 *
 * Disponível em window.ZELA.relatorios.
 * Dependências:
 *   - window.ZELA.utils (fmtBRL, fmtNum, esc, cleanText)
 *   - window.ZELA.icon
 *   - window.ZELA.classificarItem + window.ZELA.categorias
 *
 * Carregado pelo data-loader.js (depois dos módulos base, antes de app.js).
 */
(function () {
  "use strict";
  window.ZELA = window.ZELA || {};

  const u = window.ZELA.utils;
  if (!u) {
    console.error("[relatorios] window.ZELA.utils ausente. Carregue modules/utils.js primeiro.");
    return;
  }
  const { fmtBRL, esc, cleanText } = u;

  function $(id) { return document.getElementById(id); }
  function icon(nome, opts) {
    return (window.ZELA.icon || function () { return ""; })(nome, opts);
  }

  // ============================================================
  // Timeline de sinais de atenção
  // ============================================================
  function renderTimelineSinais() {
    const el = $("timelineSinais");
    const block = $("timelineSinaisBlock");
    if (!el || !block) return;

    const D = window.ZELA_DATA || {};
    const pf = D.prefeitura || {};
    const eventos = [];
    const contratos = pf.contratos || [];
    const emendasAll = D.emendas || [];

    // 1) Contratos de alto valor com objeto vago/curto
    contratos.forEach(c => {
      const obj = (c.objeto || "").trim();
      const valor = Number(c.valor) || 0;
      if (valor >= 500000 && obj.length < 40 && c.data_assinatura) {
        eventos.push({
          data: c.data_assinatura,
          tipo: "red",
          tag: "Contrato vago",
          titulo: `${fmtBRL(valor)} — ${cleanText(c.contratado || "—")}`,
          desc: `Contrato de alto valor com objeto curto (${obj.length} caracteres): "${esc(obj || "sem descrição")}". Pedir Termo de Referência por LAI.`,
          link: "prefeitura.html?q=" + encodeURIComponent(c.contratado || ""),
        });
      }
    });

    // 2) Contratos acima de R$ 1 mi sem CNPJ válido
    contratos.forEach(c => {
      const valor = Number(c.valor) || 0;
      if (valor >= 1000000 && (!c.cnpj || c.cnpj.includes("*"))) {
        if (!c.data_assinatura) return;
        eventos.push({
          data: c.data_assinatura,
          tipo: "orange",
          tag: "CNPJ oculto",
          titulo: `Contrato de ${fmtBRL(valor)} sem CNPJ identificável`,
          desc: `${cleanText(c.contratado || "—")} — modalidade ${esc(cleanText(c.modalidade || "n/i"))}. Pedir cópia integral do contrato.`,
          link: "prefeitura.html?q=" + encodeURIComponent(c.contratado || ""),
        });
      }
    });

    // 3) Emendas sem pagamento de alto valor
    const cruzMap = {};
    ((pf.emendas_cruzadas) || []).forEach(c => { cruzMap[c.numero + "/" + c.ano] = c; });
    emendasAll.forEach(e => {
      const cruz = cruzMap[e.numero + "/" + e.ano] || {};
      const valor = Number(e.valor_brl) || 0;
      if (valor >= 50000 && cruz.status === "sem_pagamento") {
        const dataRef = e.data || e.data_publicacao || (e.ano ? `${e.ano}-12-31` : null);
        if (!dataRef) return;
        eventos.push({
          data: dataRef,
          tipo: "gold",
          tag: "Emenda sem execução",
          titulo: `${fmtBRL(valor)} prometidos a ${esc(cleanText(e.beneficiario || "—"))}`,
          desc: `Emenda de ${esc(e.autor || "vereador não identificado")} (Câmara) sem pagamento localizado pela Prefeitura.`,
          link: "camara.html?q=" + encodeURIComponent(e.beneficiario || ""),
        });
      }
    });

    // Ordena por data decrescente
    eventos.sort((a, b) => (b.data || "").localeCompare(a.data || ""));
    const top = eventos.slice(0, 25);
    if (!top.length) return;

    el.innerHTML = top.map(ev => {
      const dt = ev.data.split("-");
      const dataBr = dt.length === 3 ? `${dt[2]}/${dt[1]}/${dt[0]}` : ev.data;
      return `<div class="tline-item tline-item--${ev.tipo}">
        <div class="tline-data">${dataBr}</div>
        <h4 class="tline-titulo">${ev.titulo}</h4>
        <p class="tline-desc">
          <span class="tline-tag tline-tag--${ev.tipo}">${ev.tag}</span>
          ${ev.desc}
        </p>
        ${ev.link ? `<a href="${ev.link}" class="btn-link" style="font-size:.82rem;">Ver detalhes →</a>` : ""}
      </div>`;
    }).join("");

    block.hidden = false;
  }

  // ============================================================
  // Detector de fragmentação suspeita (Lei 14.133/2021)
  // ============================================================
  function detectarFragmentacao() {
    const lista = $("fragmentacaoLista");
    const block = $("fragmentacaoBlock");
    if (!lista || !block) return;

    const pf = (window.ZELA_DATA || {}).prefeitura || {};
    const LIMITE_DISPENSA = 17600;
    const contratosFrag = (pf.contratos || []).filter(c =>
      c.data_assinatura && c.contratado &&
      (Number(c.valor) || 0) > 0 && (Number(c.valor) || 0) < LIMITE_DISPENSA
    );

    // Agrupa por contratado + ano-mês
    const grupos = new Map();
    contratosFrag.forEach(c => {
      const ym = (c.data_assinatura || "").slice(0, 7); // YYYY-MM
      const k = `${(c.contratado || "").trim()}|${ym}`;
      const cur = grupos.get(k) || { contratado: c.contratado, mes: ym, itens: [] };
      cur.itens.push(c);
      grupos.set(k, cur);
    });

    // Filtra grupos suspeitos: 3+ contratos cuja soma ultrapassa o limite
    const suspeitos = [...grupos.values()]
      .filter(g => g.itens.length >= 3)
      .map(g => ({ ...g, total: g.itens.reduce((s, c) => s + (Number(c.valor) || 0), 0) }))
      .filter(g => g.total >= LIMITE_DISPENSA)
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);

    if (!suspeitos.length) return;

    lista.innerHTML = suspeitos.map(g => {
      const ym = g.mes.split("-");
      const mesBr = ym.length === 2 ? `${ym[1]}/${ym[0]}` : g.mes;
      const itensHtml = g.itens
        .sort((a, b) => (Number(b.valor) || 0) - (Number(a.valor) || 0))
        .map(c => `<li>
          <span>Contrato ${esc(c.numero || "s/n")}/${esc(c.ano || "")} — ${esc(cleanText((c.objeto || "").slice(0, 80)))}${(c.objeto || "").length > 80 ? "…" : ""}</span>
          <span>${fmtBRL(c.valor)}</span>
        </li>`).join("");
      return `<div class="frag-grupo">
        <div class="frag-grupo__head">
          <h4>${esc(cleanText(g.contratado))} <small>· ${mesBr} · ${g.itens.length} contratos</small></h4>
          <div class="frag-grupo__total">Soma: ${fmtBRL(g.total)}</div>
        </div>
        <ul class="frag-lista" style="list-style:none; padding:0; margin:0;">${itensHtml}</ul>
        <div class="frag-explica">
          <strong>Por que isto chama atenção:</strong> ${g.itens.length} contratos do mesmo fornecedor
          no mesmo mês, cada um abaixo de R$ 17.600 (limite de dispensa), mas somando ${fmtBRL(g.total)}.
          Pedir por LAI: termo de referência único, justificativa para fracionamento e plano anual de contratações.
        </div>
      </div>`;
    }).join("");

    block.hidden = false;
  }

  // ============================================================
  // Comparativo entre anos por categoria
  // ============================================================
  function renderComparativoAnos() {
    const el = $("comparativoAnosTabela");
    const block = $("comparativoAnosBlock");
    if (!el || !block) return;

    const pf = (window.ZELA_DATA || {}).prefeitura || {};
    const contratosComp = pf.contratos || [];
    if (!contratosComp.length) return;

    const anos = [...new Set(contratosComp.map(c => String(c.ano || "")).filter(Boolean))]
      .sort((a, b) => Number(a) - Number(b));
    if (anos.length < 2) return;

    const mapa = {};
    const totaisAno = {};
    contratosComp.forEach(c => {
      const ano = String(c.ano || "");
      if (!ano) return;
      const cat = (window.ZELA.classificarItem || (() => null))(c) || "outros";
      mapa[cat] = mapa[cat] || {};
      mapa[cat][ano] = (mapa[cat][ano] || 0) + (Number(c.valor) || 0);
      totaisAno[ano] = (totaisAno[ano] || 0) + (Number(c.valor) || 0);
    });

    const catLabel = (id) => {
      const cat = (window.ZELA.categorias || []).find(c => c.id === id);
      if (cat) return `${icon(cat.iconKey, { size: 14 })} ${cat.label}`;
      return "Outros";
    };

    const anoFinal = anos[anos.length - 1];
    const cats = Object.keys(mapa).sort((a, b) =>
      (mapa[b][anoFinal] || 0) - (mapa[a][anoFinal] || 0)
    );

    const fmtVar = (atual, anterior) => {
      if (!anterior || anterior === 0) return atual > 0 ? `<span class="comp-var--up">novo</span>` : `<span class="comp-var--flat">—</span>`;
      const pct = ((atual - anterior) / anterior * 100);
      if (Math.abs(pct) < 5) return `<span class="comp-var--flat">${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%</span>`;
      const cls = pct > 0 ? "comp-var--up" : "comp-var--down";
      return `<span class="${cls}">${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%</span>`;
    };

    let html = `<div style="overflow-x:auto;"><table class="comp-anos-table"><thead><tr>
      <th scope="col">Categoria</th>`;
    anos.forEach((ano, i) => {
      html += `<th scope="col">${ano}</th>`;
      if (i > 0) html += `<th scope="col">Variação</th>`;
    });
    html += `</tr></thead><tbody>`;

    cats.forEach(cat => {
      html += `<tr><td>${catLabel(cat)}</td>`;
      anos.forEach((ano, i) => {
        const v = mapa[cat][ano] || 0;
        html += `<td>${v > 0 ? fmtBRL(v) : "—"}</td>`;
        if (i > 0) {
          const ant = mapa[cat][anos[i - 1]] || 0;
          html += `<td>${fmtVar(v, ant)}</td>`;
        }
      });
      html += `</tr>`;
    });

    html += `</tbody><tfoot><tr><td><strong>Total</strong></td>`;
    anos.forEach((ano, i) => {
      html += `<td>${fmtBRL(totaisAno[ano] || 0)}</td>`;
      if (i > 0) {
        html += `<td>${fmtVar(totaisAno[ano] || 0, totaisAno[anos[i - 1]] || 0)}</td>`;
      }
    });
    html += `</tr></tfoot></table></div>`;

    el.innerHTML = html;
    block.hidden = false;
  }

  // ============================================================
  // Inicia todos os blocos auto-contidos da página de Relatórios
  // ============================================================
  function renderTodos() {
    renderTimelineSinais();
    detectarFragmentacao();
    renderComparativoAnos();
  }

  window.ZELA.relatorios = Object.freeze({
    renderTimelineSinais,
    detectarFragmentacao,
    renderComparativoAnos,
    renderTodos,
  });
})();
