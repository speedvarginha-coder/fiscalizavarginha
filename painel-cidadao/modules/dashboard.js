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
  // MODAL DE CATEGORIA — popup focado com os contratos da categoria
  // ============================================================
  function abrirModalCategoria(catId) {
    if (!window.ZELA.dossie || !window.ZELA.dossie.abrirComHtml) return;
    const pf = (window.ZELA_DATA || {}).prefeitura || {};
    const contratos = pf.contratos || [];
    const meta = (window.ZELA.categorias || []).find(c => c.id === catId);
    const label = meta ? meta.label : catId;

    // Mantém o índice original para abrir o dossiê completo (ZELA.abrirContrato)
    const lista = contratos
      .map((c, idx) => ({ c, idx }))
      .filter(o => window.ZELA.classificarItem(o.c) === catId)
      .sort((a, b) => (Number(b.c.valor) || 0) - (Number(a.c.valor) || 0));

    const total = lista.reduce((s, o) => s + (Number(o.c.valor) || 0), 0);
    const LIMITE = 60;
    const exibidos = lista.slice(0, LIMITE);

    const linhas = exibidos.map(o => {
      const c = o.c;
      const objeto = cleanText(c.objeto || "Objeto não informado");
      const empresa = cleanText(c.contratado || "Empresa não informada");
      const ano = c.ano ? " · " + esc(String(c.ano)) : "";
      const mod = c.modalidade ? " · " + esc(cleanText(c.modalidade)) : "";
      return (
        '<li style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:8px;background:var(--white);">' +
          '<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap;">' +
            '<strong style="font-size:.98rem;">' + esc(empresa) + '</strong>' +
            '<strong style="color:var(--navy);white-space:nowrap;">' + fmtBRL(Number(c.valor) || 0) + '</strong>' +
          '</div>' +
          '<div style="font-size:.86rem;color:var(--muted);margin:4px 0 8px;line-height:1.4;">' +
            esc(objeto.length > 160 ? objeto.slice(0, 159) + "…" : objeto) +
            '<span style="color:var(--muted);">' + ano + mod + '</span>' +
          '</div>' +
          '<button type="button" class="btn-small" onclick="ZELA.abrirContrato(' + o.idx + ')">Ver detalhes e fonte</button>' +
        '</li>'
      );
    }).join("");

    const maisNota = lista.length > LIMITE
      ? '<p class="muted small" style="margin-top:10px;">Mostrando os ' + LIMITE +
        ' maiores de ' + fmtNum(lista.length) + '. Use a busca na aba Contratos para os demais.</p>'
      : "";

    const html =
      '<div class="cat-modal">' +
        '<h3 style="margin:0 0 4px;display:flex;align-items:center;gap:8px;">' +
          icon(meta ? meta.iconKey : "documentos", { size: 22 }) + ' ' + esc(label) +
        '</h3>' +
        '<p class="muted" style="margin:0 0 14px;">' +
          fmtNum(lista.length) + ' contrato' + (lista.length === 1 ? "" : "s") +
          ' · total ' + fmtBRL(total) +
          ' · clique em um contrato para ver a fonte oficial.' +
        '</p>' +
        (lista.length
          ? '<ul style="list-style:none;padding:0;margin:0;">' + linhas + '</ul>' + maisNota
          : '<p>Nenhum contrato encontrado nesta categoria.</p>') +
      '</div>';

    window.ZELA.dossie.abrirComHtml(html);
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
      // Deixa a aba Contratos já filtrada por baixo (para quando fechar o popup)
      if (window.ZELA.filtrarContratosPorCategoria) {
        window.ZELA.filtrarContratosPorCategoria(cat);
      }
      // Abre o popup focado só com os contratos da categoria escolhida.
      // "Limpar filtro" (cat vazio) não abre popup.
      if (cat) {
        abrirModalCategoria(cat);
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
    // Métrica honesta: quantas emendas têm o beneficiário recebendo pagamentos
    // localizados no portal (status "encontrado"). NÃO somamos valor_pago_total
    // porque ele é o total pago ao CNPJ — não a fração da emenda paga. Somá-lo
    // contava o mesmo beneficiário várias vezes e gerava % > 100% (bug).
    const localizadas = emendas.reduce((n, e) =>
      n + (((cruzMapLocal[e.numero + "/" + e.ano] || {}).status === "encontrado") ? 1 : 0), 0);
    const pctLocalizado = emendas.length > 0
      ? Math.round((localizadas / emendas.length) * 100) : 0;

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
        <span class="placar-card__valor">${pctLocalizado}%</span>
        <span class="placar-card__label">Beneficiário com pagamento localizado</span>
        <span class="placar-card__sub"><strong>${fmtNum(localizadas)}</strong> de ${fmtNum(emendas.length)} emendas no portal</span>
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
  // MODAL DE CATEGORIA — popup focado com as EMENDAS da categoria (Câmara)
  // ============================================================
  function abrirModalCategoriaEmendas(catId) {
    if (!window.ZELA.dossie || !window.ZELA.dossie.abrirComHtml) return;
    const emendas = (window.ZELA_DATA || {}).emendas || [];
    const meta = (window.ZELA.categorias || []).find(c => c.id === catId);
    const label = meta ? meta.label : catId;

    const lista = emendas
      .filter(e => window.ZELA.classificarItem({ objeto: e.objeto, beneficiario: e.beneficiario }) === catId)
      .sort((a, b) => (Number(b.valor_brl) || 0) - (Number(a.valor_brl) || 0));

    const total = lista.reduce((s, e) => s + (Number(e.valor_brl) || 0), 0);
    const LIMITE = 60;
    const exibidos = lista.slice(0, LIMITE);

    const linhas = exibidos.map(e => {
      const benef = cleanText(e.beneficiario || "Beneficiário não informado");
      const autor = e.autor ? esc(cleanText(e.autor)) : "";
      const objeto = cleanText(e.objeto || "");
      const fonte = e.pdf
        ? '<a href="' + esc(e.pdf) + '" target="_blank" rel="noopener" class="btn-small" style="text-decoration:none;display:inline-block;">Ver no SAPL (fonte oficial)</a>'
        : '';
      return (
        '<li style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:8px;background:var(--white);">' +
          '<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap;">' +
            '<strong style="font-size:.98rem;">' + esc(benef) + '</strong>' +
            '<strong style="color:var(--navy);white-space:nowrap;">' + fmtBRL(Number(e.valor_brl) || 0) + '</strong>' +
          '</div>' +
          (autor ? '<div style="font-size:.8rem;color:var(--muted);margin-top:2px;">Emenda de <strong>' + autor + '</strong></div>' : '') +
          (objeto ? '<div style="font-size:.86rem;color:var(--muted);margin:6px 0 8px;line-height:1.4;">' +
            esc(objeto.length > 160 ? objeto.slice(0, 159) + "…" : objeto) + '</div>' : '<div style="margin-bottom:8px;"></div>') +
          fonte +
        '</li>'
      );
    }).join("");

    const maisNota = lista.length > LIMITE
      ? '<p class="muted small" style="margin-top:10px;">Mostrando as ' + LIMITE +
        ' maiores de ' + fmtNum(lista.length) + '.</p>'
      : "";

    const html =
      '<div class="cat-modal">' +
        '<h3 style="margin:0 0 4px;display:flex;align-items:center;gap:8px;">' +
          icon(meta ? meta.iconKey : "documentos", { size: 22 }) + ' ' + esc(label) +
          ' <span style="font-weight:600;color:var(--muted);font-size:.9rem;">· emendas</span>' +
        '</h3>' +
        '<p class="muted" style="margin:0 0 14px;">' +
          fmtNum(lista.length) + ' emenda' + (lista.length === 1 ? "" : "s") +
          ' · total ' + fmtBRL(total) +
          ' · clique em "Ver no SAPL" para a fonte oficial.' +
        '</p>' +
        (lista.length
          ? '<ul style="list-style:none;padding:0;margin:0;">' + linhas + '</ul>' + maisNota
          : '<p>Nenhuma emenda encontrada nesta categoria.</p>') +
      '</div>';

    window.ZELA.dossie.abrirComHtml(html);
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
      // Deixa a lista de emendas filtrada por baixo (para quando fechar o popup)
      if (window.ZELA.filtrarEmendasPorCategoria) {
        window.ZELA.filtrarEmendasPorCategoria(cat);
      }
      // Abre o popup focado só com as emendas da categoria. "Limpar" não abre.
      if (cat) {
        abrirModalCategoriaEmendas(cat);
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
