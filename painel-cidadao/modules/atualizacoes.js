/* Zela Varginha — modules/atualizacoes.js
 *
 * Feed cronológico de atos administrativos (contratos, aditivos, dispensas,
 * compras diretas, licitações) da Prefeitura e Câmara.
 *
 * Lê window.ZELA_DATA.atualizacoes (chunk JSON gerado pelo coletor do Diário).
 * Renderiza: dashboard de stats, filtros, cards agrupados por data.
 *
 * Disponível em window.ZELA.atualizacoes.
 * Dependências:
 *   - window.ZELA.utils (esc, cleanText, fmtBRL, fmtNum, norm)
 *   - window.ZELA.icon
 *   - window.ZELA.watchlist (para estrela de acompanhar)
 */
(function () {
  "use strict";
  window.ZELA = window.ZELA || {};

  const u = window.ZELA.utils;
  if (!u) {
    console.error("[atualizacoes] window.ZELA.utils ausente.");
    return;
  }
  const { esc, cleanText, fmtBRL, fmtNum, norm } = u;

  function $(id) { return document.getElementById(id); }
  function icon(nome, opts) {
    return (window.ZELA.icon || function () { return ""; })(nome, opts);
  }

  // Mapa tipo → ícone + label visual
  const TIPOS = {
    contrato:       { icone: "documentos", label: "Contrato",       cor: "navy"   },
    aditivo:        { icone: "relogio",    label: "Aditivo",        cor: "orange" },
    dispensa:       { icone: "alerta",     label: "Dispensa",       cor: "red"    },
    compra_direta:  { icone: "cifrao",     label: "Compra direta",  cor: "teal"   },
    licitacao:      { icone: "lupa",       label: "Licitação",      cor: "gold"   },
    diaria:         { icone: "transporte", label: "Diária",         cor: "navy"   },
    convenio:       { icone: "predio",     label: "Convênio",       cor: "teal"   },
  };

  // Estado dos filtros
  let filtros = {
    orgao: "",
    tipo: "",
    relevancia: "",
    busca: "",
  };

  // ============================================================
  // Stats topo
  // ============================================================
  function renderStats(atos) {
    const el = $("atualizacoesStats");
    if (!el) return;

    const hoje = new Date().toISOString().slice(0, 10);
    const seteDias = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const atosHoje = atos.filter(a => a.data === hoje).length;
    const atosSemana = atos.filter(a => a.data >= seteDias).length;
    const altos = atos.filter(a => a.relevancia === "alta").length;
    const valorSemana = atos
      .filter(a => a.data >= seteDias)
      .reduce((s, a) => {
        const v = (a.valores || []).find(v => /valor.*total|estimad|original/i.test(v.rotulo || ""));
        return s + (v ? Number(v.valor || 0) : 0);
      }, 0);

    el.innerHTML = `
      <div class="placar-card placar-card--count">
        <span class="placar-card__icon">${icon("relogio", { size: 24 })}</span>
        <span class="placar-card__valor">${fmtNum(atosHoje)}</span>
        <span class="placar-card__label">Atos publicados hoje</span>
        <span class="placar-card__sub">${atosHoje === 0 ? "Aguardando publicação" : "Conferir abaixo"}</span>
      </div>
      <div class="placar-card placar-card--money">
        <span class="placar-card__icon">${icon("cifrao", { size: 24 })}</span>
        <span class="placar-card__valor">${fmtBRL(valorSemana)}</span>
        <span class="placar-card__label">Valor movimentado (7 dias)</span>
        <span class="placar-card__sub"><strong>${fmtNum(atosSemana)}</strong> ato${atosSemana !== 1 ? "s" : ""} na semana</span>
      </div>
      <div class="placar-card placar-card--warn">
        <span class="placar-card__icon">${icon("alerta", { size: 24 })}</span>
        <span class="placar-card__valor">${fmtNum(altos)}</span>
        <span class="placar-card__label">Alta relevância</span>
        <span class="placar-card__sub">Pedem fiscalização prioritária</span>
      </div>
      <div class="placar-card placar-card--top">
        <span class="placar-card__icon">${icon("trofeu", { size: 24 })}</span>
        <span class="placar-card__valor">${fmtNum(atos.length)}</span>
        <span class="placar-card__label">Total no painel</span>
        <span class="placar-card__sub">Todos os atos disponíveis</span>
      </div>
    `;
  }

  // ============================================================
  // Cruzamento com dados existentes
  // ============================================================
  // Procura quantas vezes a empresa (raiz do CNPJ) aparece em contratos/emendas
  function cruzar(envolvido) {
    if (!envolvido || !envolvido.cnpj) return null;
    const raiz = envolvido.cnpj.replace(/[^\d]/g, "").slice(0, 8);
    if (raiz.length < 8) return null;
    const D = window.ZELA_DATA || {};
    const pf = D.prefeitura || {};
    const contratos = (pf.contratos || []).filter(c =>
      (c.cnpj || "").replace(/[^\d]/g, "").slice(0, 8) === raiz
    );
    const emendas = (D.emendas || []).filter(e =>
      (e.cnpj || "").replace(/[^\d]/g, "").slice(0, 8) === raiz
    );
    if (!contratos.length && !emendas.length) return null;
    return { contratos: contratos.length, emendas: emendas.length };
  }

  // ============================================================
  // Pergunta LAI por tipo de ato
  // ============================================================
  function perguntaLAI(ato) {
    const e0 = (ato.envolvidos || [])[0];
    const empresa = e0 ? (e0.nome || "") : "(empresa)";
    const valorTotal = (ato.valores || []).find(v => /total|estimad|original/i.test(v.rotulo || ""));
    const valor = valorTotal ? fmtBRL(valorTotal.valor) : "(valor)";

    const por_tipo = {
      contrato:      `Solicito cópia integral do contrato ${empresa}, incluindo Termo de Referência, justificativa, pesquisa de preços, ato de homologação, empenho, liquidações, notas fiscais, comprovantes de pagamento e relatório do fiscal do contrato.`,
      aditivo:       `Solicito cópia integral do aditivo ao contrato firmado com ${empresa}, justificativa técnica para a alteração, parecer jurídico autorizativo, planilha comparativa antes/depois e nova ordem de execução.`,
      dispensa:      `Solicito cópia integral do processo de dispensa de licitação para ${empresa} no valor de ${valor}, incluindo justificativa, pesquisa de preços de pelo menos 3 fornecedores, parecer jurídico autorizativo e ato de ratificação.`,
      compra_direta: `Solicito cópia integral do processo de compra direta com ${empresa} no valor de ${valor}, incluindo justificativa da necessidade, pesquisa de preços, nota fiscal e comprovante de entrega.`,
      licitacao:     `Solicito edital integral, anexos, ata de abertura, resultado final, ato de homologação e contrato resultante da licitação ${ato.titulo}, valor estimado de ${valor}.`,
      diaria:        `Solicito cópia integral do processo administrativo da diária paga, justificativa da viagem, autorização superior, comprovantes de participação, certificados e prestação de contas.`,
      convenio:      `Solicito cópia integral do convênio firmado com ${empresa}, plano de trabalho, prestação de contas parcial e final, relatório de execução e comprovantes de aplicação dos recursos.`,
    };
    return por_tipo[ato.tipo] || por_tipo.contrato;
  }

  // ============================================================
  // Card de ato
  // ============================================================
  function renderCard(ato) {
    const t = TIPOS[ato.tipo] || TIPOS.contrato;
    const dataBr = ato.data.split("-").reverse().join("/");

    const envolvidosHtml = (ato.envolvidos || []).map(e => {
      const cruz = cruzar(e);
      const cruzBadge = cruz
        ? `<span class="tline-tag tline-tag--blue" style="margin-left:6px;" title="Esta empresa já aparece em outros atos do painel">Histórico: ${cruz.contratos} contrato${cruz.contratos !== 1 ? "s" : ""}${cruz.emendas > 0 ? " · " + cruz.emendas + " emenda" + (cruz.emendas !== 1 ? "s" : "") : ""}</span>`
        : "";
      return `<li>
        <strong>${esc(cleanText(e.nome || ""))}</strong>
        ${e.cnpj ? `<span class="muted small" style="font-family:var(--font-mono); margin-left:6px;">${esc(e.cnpj)}</span>` : ""}
        ${e.papel ? `<span class="muted small">· ${esc(e.papel)}</span>` : ""}
        ${cruzBadge}
      </li>`;
    }).join("");

    const valoresHtml = (ato.valores || []).map(v => {
      const valorFmt = typeof v.valor === "number" && v.rotulo && /quantidad|qtd/i.test(v.rotulo)
        ? fmtNum(v.valor)
        : fmtBRL(v.valor || 0);
      return `<li><span class="muted small">${esc(v.rotulo || "")}:</span> <strong>${valorFmt}</strong></li>`;
    }).join("");

    const atencaoHtml = (ato.pontos_atencao || []).map(p =>
      `<li>${esc(cleanText(p))}</li>`
    ).join("");

    // Botão watchlist
    const idAto = ato.id || `${ato.data}-${ato.titulo}`;
    const btnWatch = (window.ZELA.watchlist || {}).botao
      ? window.ZELA.watchlist.botao("atualizacoes", idAto)
      : "";

    // Compartilhar WhatsApp
    const msgWa = encodeURIComponent(
      `🚨 *${ato.titulo}*\n📅 ${dataBr} — ${ato.orgao}\n${ato.resumo}\n\nVer mais: ${window.location.href}#${idAto}`
    );
    const linkWa = `https://api.whatsapp.com/send?text=${msgWa}`;

    const pergunta = perguntaLAI(ato);

    return `<article class="tline-item tline-item--${t.cor}" id="${esc(idAto)}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div class="tline-data">${dataBr} · ${ato.orgao}</div>
        ${btnWatch}
      </div>
      <h4 class="tline-titulo">${esc(cleanText(ato.titulo))}</h4>
      <p class="tline-desc">
        <span class="tline-tag tline-tag--${t.cor}">${icon(t.icone, { size: 12 })} ${t.label}</span>
        ${ato.relevancia ? `<span class="tline-tag tline-tag--${relevanciaCor(ato.relevancia)}">${relevanciaLabel(ato.relevancia)}</span>` : ""}
        ${ato.categoria ? `<span class="tline-tag tline-tag--gold">${esc(ato.categoria)}</span>` : ""}
      </p>
      <p style="margin:8px 0; line-height:1.5;">${esc(cleanText(ato.resumo || ""))}</p>

      ${envolvidosHtml ? `
        <details style="margin:10px 0;">
          <summary style="cursor:pointer; font-weight:600; font-size:.88rem;">🏢 Envolvidos</summary>
          <ul style="margin:8px 0 0 18px; font-size:.88rem;">${envolvidosHtml}</ul>
        </details>
      ` : ""}

      ${valoresHtml ? `
        <details style="margin:10px 0;" open>
          <summary style="cursor:pointer; font-weight:600; font-size:.88rem;">💰 Valores identificados</summary>
          <ul style="margin:8px 0 0 18px; font-size:.88rem;">${valoresHtml}</ul>
        </details>
      ` : ""}

      ${atencaoHtml ? `
        <details style="margin:10px 0;" open>
          <summary style="cursor:pointer; font-weight:600; font-size:.88rem; color:var(--red);">🚨 Pontos de atenção</summary>
          <ul style="margin:8px 0 0 18px; font-size:.88rem; color:var(--ink);">${atencaoHtml}</ul>
        </details>
      ` : ""}

      <div style="margin-top:14px; display:flex; gap:8px; flex-wrap:wrap;">
        ${ato.publicacao_url ? `<a class="btn-link" href="${esc(ato.publicacao_url)}" target="_blank" rel="noopener" style="padding:6px 12px; background:#e8f4fd; color:#1565c0; border-radius:4px; font-size:.82em; font-weight:600; text-decoration:none; border:1px solid #90caf9;">${icon("lupa", { size: 14 })} Ver publicação oficial</a>` : ""}
        ${ato.anexo_pdf ? `<a class="btn-link" href="${esc(ato.anexo_pdf)}" target="_blank" rel="noopener" style="padding:6px 12px; background:#fff3e0; color:#6d4c00; border-radius:4px; font-size:.82em; font-weight:600; text-decoration:none; border:1px solid #ffd54f;">📎 PDF do ato</a>` : ""}
        <a class="btn-link" href="${linkWa}" target="_blank" rel="noopener" style="padding:6px 12px; background:#0b5f3a; color:white; border-radius:4px; font-size:.82em; font-weight:600; text-decoration:none;">📱 Compartilhar</a>
        <button type="button" class="btn-link" onclick="window.ZELA.atualizacoes.copiarLAI('${idAto.replace(/'/g, "\\'")}')" style="padding:6px 12px; background:#fff8e1; color:#6d4c00; border-radius:4px; font-size:.82em; font-weight:600; border:1px solid #ffd54f; cursor:pointer;">📋 Copiar pergunta LAI</button>
      </div>

      <textarea class="dossier-lai-pergunta" data-id="${esc(idAto)}" readonly hidden>${esc(pergunta)}</textarea>
    </article>`;
  }

  function relevanciaCor(r) {
    if (r === "alta") return "red";
    if (r === "media") return "orange";
    return "gold";
  }
  function relevanciaLabel(r) {
    if (r === "alta") return "⚠ Alta relevância";
    if (r === "media") return "Relevância média";
    return "Relevância baixa";
  }

  // ============================================================
  // Render principal
  // ============================================================
  function render() {
    const dados = (window.ZELA_DATA || {}).atualizacoes || {};
    const atos = dados.atos || [];

    // Aplica filtros
    const q = norm(filtros.busca);
    const view = atos.filter(a => {
      if (filtros.orgao && a.orgao !== filtros.orgao) return false;
      if (filtros.tipo && a.tipo !== filtros.tipo) return false;
      if (filtros.relevancia && a.relevancia !== filtros.relevancia) return false;
      if (q) {
        const hay = norm(
          [a.titulo, a.resumo, a.categoria, a.tipo, a.orgao,
           ...(a.envolvidos || []).map(e => e.nome + " " + e.cnpj),
           ...(a.pontos_atencao || [])
          ].filter(Boolean).join(" ")
        );
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    // Stats
    renderStats(atos);

    // Contador
    const contador = $("atualizacoesContador");
    if (contador) contador.textContent = `${view.length} ato${view.length !== 1 ? "s" : ""}`;

    // Empty state
    const feedEl = $("atualizacoesFeed");
    const emptyEl = $("atualizacoesEmpty");
    if (!view.length) {
      if (feedEl) feedEl.innerHTML = "";
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    // Ordena por data decrescente
    const sorted = [...view].sort((a, b) => (b.data || "").localeCompare(a.data || ""));

    // Renderiza cards
    if (feedEl) feedEl.innerHTML = sorted.map(renderCard).join("");

    // Atualiza visual dos chips ativos
    document.querySelectorAll("#atualizacoesFiltros .cat-chip").forEach(chip => {
      const filtro = chip.dataset.filtro;
      const valor = chip.dataset.valor;
      if (!filtro) {
        chip.classList.remove("is-active");
        return;
      }
      chip.classList.toggle("is-active", filtros[filtro] === valor && valor !== "");
    });
  }

  // ============================================================
  // Copiar pergunta LAI
  // ============================================================
  function copiarLAI(id) {
    const ta = document.querySelector(`textarea.dossier-lai-pergunta[data-id="${id}"]`);
    if (!ta) return;
    navigator.clipboard.writeText(ta.value).then(() => {
      const btn = event.currentTarget;
      const old = btn.textContent;
      btn.textContent = "✓ Copiado";
      setTimeout(() => { btn.textContent = old; }, 1600);
    }).catch(() => {
      ta.hidden = false;
      ta.select();
      document.execCommand("copy");
      ta.hidden = true;
    });
  }

  // ============================================================
  // Init — chamado quando a página atualizacoes.html carrega
  // ============================================================
  function init() {
    if (document.body.dataset.page !== "atualizacoes") return;

    const filtrosEl = $("atualizacoesFiltros");
    if (filtrosEl) {
      filtrosEl.addEventListener("click", e => {
        const chip = e.target.closest(".cat-chip");
        if (!chip) return;
        const filtro = chip.dataset.filtro;
        const valor = chip.dataset.valor;
        if (!filtro || !valor) {
          // Limpar tudo
          filtros = { orgao: "", tipo: "", relevancia: "", busca: filtros.busca };
        } else {
          filtros[filtro] = filtros[filtro] === valor ? "" : valor;
        }
        render();
      });
    }

    const buscaEl = $("filtroAtualizacoes");
    if (buscaEl) {
      buscaEl.addEventListener("input", () => {
        filtros.busca = buscaEl.value || "";
        render();
      });
    }

    render();
  }

  window.ZELA.atualizacoes = Object.freeze({
    init,
    render,
    copiarLAI,
  });
})();
