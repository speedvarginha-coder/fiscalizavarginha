/* Fiscaliza Varginha — modules/dashboard.js
 *
 * Placar do Dinheiro + Chips de Categoria das páginas Prefeitura e Câmara.
 * Lê window.ZELA_DATA diretamente. Cria os 4 cards de cada placar e os
 * chips clicáveis que filtram a lista correspondente.
 *
 * Disponível em window.ZELA.dashboard.
 * Dependências:
 *   - window.ZELA.utils (fmtBRL, fmtNum, esc, cleanText)
 *   - window.ZELA.icon  (modules/icons.js)
 *   - window.ZELA.categorias + classificarItem  (modules/categorias.js)
 *   - window.ZELA.carimboColeta  (definido em app.js)
 *   - window.ZELA.filtrarContratosPorCategoria  (closure de renderContratos)
 *   - window.ZELA.filtrarEmendasPorCategoria    (closure de renderEmendas)
 *
 * Carregado pelo data-loader.js (depois dos módulos base, antes de app.js).
 */
(function () {
  "use strict";
  window.ZELA = window.ZELA || {};

  const u = window.ZELA.utils;
  if (!u) {
    console.error("[dashboard] window.ZELA.utils ausente. Carregue modules/utils.js primeiro.");
    return;
  }
  const { fmtBRL, fmtNum, esc, cleanText } = u;

  // População de Varginha-MG (Censo IBGE 2022). Usada para traduzir
  // totais em "quanto representa por morador" — número que o cidadão sente.
  const POP_VARGINHA = 135159;
  function perCapita(total) {
    const v = Number(total) || 0;
    if (v <= 0) return "";
    return `≈ ${fmtBRL(v / POP_VARGINHA)} por morador de Varginha`;
  }

  function $(id) { return document.getElementById(id); }
  function icon(nome, opts) {
    return (window.ZELA.icon || function () { return ""; })(nome, opts);
  }
  function carimboColeta() {
    return (window.ZELA.carimboColeta || function () { return ""; })();
  }

  // ============================================================
  // PLACAR — PREFEITURA
  // ============================================================
  function renderPlacarPrefeitura() {
    const el = $("placarPrefeitura");
    if (!el) return;
    const pf = (window.ZELA_DATA || {}).prefeitura || {};
    const contratos = pf.contratos || [];
    const anoAtual = String(pf.ano_atual || new Date().getFullYear());
    const contratosAno = contratos.filter(c => String(c.ano || "") === anoAtual);
    const total = contratosAno.reduce((s, c) => s + (Number(c.valor) || 0), 0);

    // Top fornecedor
    const porForn = new Map();
    contratosAno.forEach(c => {
      const k = (c.contratado || "—").trim();
      const cur = porForn.get(k) || { nome: k, valor: 0, qtd: 0 };
      cur.valor += Number(c.valor) || 0;
      cur.qtd += 1;
      porForn.set(k, cur);
    });
    const topForn = [...porForn.values()].sort((a, b) => b.valor - a.valor)[0];

    const alertasObj = contratos.filter(c => ((c.objeto || "").trim().length < 25)).length;

    el.innerHTML = `
      <div class="placar-card placar-card--money">
        <span class="placar-card__icon">${icon("cifrao", { size: 24 })}</span>
        <span class="placar-card__valor">${fmtBRL(total)}</span>
        <span class="placar-card__label">Total contratado ${carimboColeta()}</span>
        <span class="placar-card__sub">Em <strong>${anoAtual}</strong> · ${contratosAno.length} contrato${contratosAno.length !== 1 ? "s" : ""}</span>
        <span class="placar-card__percapita">${perCapita(total)}</span>
      </div>
      <div class="placar-card placar-card--top">
        <span class="placar-card__icon">${icon("trofeu", { size: 24 })}</span>
        <span class="placar-card__valor">${topForn ? esc(cleanText(topForn.nome.split(" ").slice(0, 4).join(" "))) : "—"}</span>
        <span class="placar-card__label">Maior fornecedor</span>
        <span class="placar-card__sub">${topForn ? `<strong>${fmtBRL(topForn.valor)}</strong> · ${topForn.qtd} contrato${topForn.qtd > 1 ? "s" : ""}` : "Sem dados"}</span>
      </div>
      <div class="placar-card placar-card--count">
        <span class="placar-card__icon">${icon("documentos", { size: 24 })}</span>
        <span class="placar-card__valor">${fmtNum(contratos.length)}</span>
        <span class="placar-card__label">Contratos no painel</span>
        <span class="placar-card__sub">Todos os anos disponíveis</span>
      </div>
      <div class="placar-card placar-card--warn">
        <span class="placar-card__icon">${icon("alerta", { size: 24 })}</span>
        <span class="placar-card__valor">${fmtNum(alertasObj)}</span>
        <span class="placar-card__label">Contratos com objeto vago</span>
        <span class="placar-card__sub">Descrição menor que 25 caracteres</span>
      </div>
    `;
  }

  // ============================================================
  // CATEGORIAS — PREFEITURA
  // ============================================================
  function renderCategoriasPrefeitura() {
    const el = $("catChipsPrefeitura");
    if (!el) return;
    const pf = (window.ZELA_DATA || {}).prefeitura || {};
    const contratos = pf.contratos || [];

    const contagem = {};
    contratos.forEach(c => {
      const cat = window.ZELA.classificarItem(c);
      if (cat) contagem[cat] = (contagem[cat] || 0) + 1;
    });
    const cats = (window.ZELA.categorias || []).filter(c => (contagem[c.id] || 0) > 0);
    if (!cats.length) { el.style.display = "none"; return; }

    el.innerHTML =
      `<span class="cat-chips__label">Filtrar por categoria:</span>` +
      cats.map(cat => `
        <button type="button" class="cat-chip" data-cat="${cat.id}">
          ${icon(cat.iconKey, { size: 16 })} ${cat.label}
          <span class="cat-chip__count">${contagem[cat.id]}</span>
        </button>
      `).join("") +
      `<button type="button" class="cat-chip cat-chip--clear" data-cat="">Limpar filtro</button>`;

    const aplicarCat = (cat) => {
      el.querySelectorAll(".cat-chip").forEach(b => {
        b.classList.toggle("is-active", b.dataset.cat === cat && cat !== "");
      });
      if (window.ZELA.filtrarContratosPorCategoria) {
        window.ZELA.filtrarContratosPorCategoria(cat);
      }
      if (cat) {
        document.querySelectorAll('.pref-tab[data-pref-tab="contratos"]').forEach(t => t.click());
      }
    };
    el.querySelectorAll(".cat-chip").forEach(btn => {
      btn.addEventListener("click", () => aplicarCat(btn.dataset.cat));
    });
    window.ZELA.aplicarCategoriaPrefeitura = aplicarCat;
  }

  // ============================================================
  // PLACAR — CÂMARA
  // ============================================================
  function renderPlacarCamara() {
    const el = $("placarCamara");
    if (!el) return;
    const D = window.ZELA_DATA || {};
    const pf = D.prefeitura || {};
    const emendas = D.emendas || [];
    const total = emendas.reduce((s, e) => s + (Number(e.valor_brl) || 0), 0);

    // Cruzamento map
    const cruzMapLocal = {};
    ((pf.emendas_cruzadas) || []).forEach(c => { cruzMapLocal[c.numero + "/" + c.ano] = c; });
    const totalPago = emendas.reduce((s, e) =>
      s + (Number((cruzMapLocal[e.numero + "/" + e.ano] || {}).valor_pago_total) || 0), 0);
    const pctPago = total > 0 ? Math.round((totalPago / total) * 100) : 0;

    // Top beneficiário
    const porBen = new Map();
    emendas.forEach(e => {
      const k = (e.beneficiario || "—").trim();
      const cur = porBen.get(k) || { nome: k, valor: 0, qtd: 0 };
      cur.valor += Number(e.valor_brl) || 0;
      cur.qtd += 1;
      porBen.set(k, cur);
    });
    const topBen = [...porBen.values()].sort((a, b) => b.valor - a.valor)[0];

    const semPag = emendas.filter(e =>
      (cruzMapLocal[e.numero + "/" + e.ano] || {}).status === "sem_pagamento"
    ).length;

    el.innerHTML = `
      <div class="placar-card placar-card--money">
        <span class="placar-card__icon">${icon("cifrao", { size: 24 })}</span>
        <span class="placar-card__valor">${fmtBRL(total)}</span>
        <span class="placar-card__label">Total em emendas ${carimboColeta()}</span>
        <span class="placar-card__sub">Destinado por <strong>vereadores</strong></span>
        <span class="placar-card__percapita">${perCapita(total)}</span>
      </div>
      <div class="placar-card placar-card--top">
        <span class="placar-card__icon">${icon("trofeu", { size: 24 })}</span>
        <span class="placar-card__valor">${topBen ? esc(cleanText(topBen.nome.split(" ").slice(0, 4).join(" "))) : "—"}</span>
        <span class="placar-card__label">Maior beneficiário</span>
        <span class="placar-card__sub">${topBen ? `<strong>${fmtBRL(topBen.valor)}</strong> · ${topBen.qtd} emenda${topBen.qtd > 1 ? "s" : ""}` : "Sem dados"}</span>
      </div>
      <div class="placar-card placar-card--count">
        <span class="placar-card__icon">${icon("cheque", { size: 24 })}</span>
        <span class="placar-card__valor">${pctPago}%</span>
        <span class="placar-card__label">Foi efetivamente pago</span>
        <span class="placar-card__sub"><strong>${fmtBRL(totalPago)}</strong> conferidos no portal</span>
      </div>
      <div class="placar-card placar-card--warn">
        <span class="placar-card__icon">${icon("alerta", { size: 24 })}</span>
        <span class="placar-card__valor">${fmtNum(semPag)}</span>
        <span class="placar-card__label">Sem pagamento localizado</span>
        <span class="placar-card__sub">Promessas que ainda não viraram dinheiro</span>
      </div>
    `;
  }

  // ============================================================
  // CATEGORIAS — CÂMARA
  // ============================================================
  function renderCategoriasCamara() {
    const el = $("catChipsCamara");
    if (!el) return;
    const emendas = (window.ZELA_DATA || {}).emendas || [];

    const contagem = {};
    emendas.forEach(e => {
      const cat = window.ZELA.classificarItem({ objeto: e.objeto, beneficiario: e.beneficiario });
      if (cat) contagem[cat] = (contagem[cat] || 0) + 1;
    });
    const cats = (window.ZELA.categorias || []).filter(c => (contagem[c.id] || 0) > 0);
    if (!cats.length) { el.style.display = "none"; return; }

    el.innerHTML =
      `<span class="cat-chips__label">Filtrar emendas por categoria:</span>` +
      cats.map(cat => `
        <button type="button" class="cat-chip" data-cat="${cat.id}">
          ${icon(cat.iconKey, { size: 16 })} ${cat.label}
          <span class="cat-chip__count">${contagem[cat.id]}</span>
        </button>
      `).join("") +
      `<button type="button" class="cat-chip cat-chip--clear" data-cat="">Limpar filtro</button>`;

    const aplicarCat = (cat) => {
      el.querySelectorAll(".cat-chip").forEach(b => {
        b.classList.toggle("is-active", b.dataset.cat === cat && cat !== "");
      });
      if (window.ZELA.filtrarEmendasPorCategoria) {
        window.ZELA.filtrarEmendasPorCategoria(cat);
      }
    };
    el.querySelectorAll(".cat-chip").forEach(btn => {
      btn.addEventListener("click", () => aplicarCat(btn.dataset.cat));
    });
    window.ZELA.aplicarCategoriaCamara = aplicarCat;
  }

  // ============================================================
  // API PÚBLICA
  // ============================================================
  window.ZELA.dashboard = Object.freeze({
    renderPlacarPrefeitura,
    renderCategoriasPrefeitura,
    renderPlacarCamara,
    renderCategoriasCamara,
  });
})();
