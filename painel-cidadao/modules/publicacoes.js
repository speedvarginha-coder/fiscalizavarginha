/* Fiscaliza Varginha — Feed de publicações estruturadas (Câmara + Diário).
   Renderiza os cards "cidadãos" gerados pela coleta com IA: resumo,
   o que propõe / envolvidos+valores, pontos de atenção e link à fonte.
   Autocontido: lê window.ZELA_DATA.publicacoes_estruturadas (Câmara) e
   .publicacoes_diario (Diário). Não depende do app.js. */
(function () {
  "use strict";

  var POR_PAGINA = 12;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function brl(v) {
    var n = Number(v) || 0;
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  function dataBR(iso) {
    if (!iso) return "";
    var m = String(iso).slice(0, 10).split("-");
    return m.length === 3 ? m[2] + "/" + m[1] + "/" + m[0] : iso;
  }
  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  var state = { todas: [], fonte: "", q: "", offset: POR_PAGINA };

  function relevanciaBadge(pub) {
    var r = pub.relevancia || pub.interesse_publico || "";
    if (!r) return "";
    var cls = r === "alta" || r === "alto" ? "pub-badge--alta"
      : r === "baixa" || r === "baixo" ? "pub-badge--baixa" : "pub-badge--media";
    var txt = pub.fonte === "camara" ? "interesse " + r : "relevância " + r;
    return '<span class="pub-badge ' + cls + '">' + esc(txt) + "</span>";
  }

  function renderCard(pub) {
    var fonteLabel = pub.fonte === "camara" ? "Câmara" : "Prefeitura · Diário Oficial";
    var bloco = "";

    if (pub.fonte === "camara") {
      if (pub.o_que_propoe) {
        bloco += '<p class="pub-card__sub">O que propõe</p><p class="pub-card__txt">' + esc(pub.o_que_propoe) + "</p>";
      }
      if (pub.por_que_acompanhar && pub.por_que_acompanhar.length) {
        bloco += '<p class="pub-card__sub">Por que acompanhar</p><ul class="pub-card__list">' +
          pub.por_que_acompanhar.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
      }
    } else {
      var env = (pub.envolvidos || []).filter(function (e) { return e.nome || e.cnpj; });
      if (env.length) {
        bloco += '<p class="pub-card__sub">Envolvidos</p><p class="pub-card__txt">' +
          env.map(function (e) { return esc(e.nome || "") + (e.cnpj ? " · " + esc(e.cnpj) : ""); }).join("<br>") + "</p>";
      }
      var val = pub.valores || {};
      if (val.total) {
        bloco += '<p class="pub-card__valor">' + brl(val.total) +
          (val.modalidade ? ' <span class="pub-card__mod">' + esc(val.modalidade) + "</span>" : "") + "</p>";
      }
    }

    var pontos = (pub.pontos_atencao || []);
    var pontosHtml = pontos.length
      ? '<div class="pub-card__atencao"><strong>⚠ Pontos de atenção</strong><ul>' +
        pontos.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>"
      : "";

    var links = pub.links || {};
    var linksHtml = "";
    if (links.consulta) linksHtml += '<a href="' + esc(links.consulta) + '" target="_blank" rel="noopener">Consulta oficial ↗</a>';
    if (links.inteiro_teor) linksHtml += '<a href="' + esc(links.inteiro_teor) + '" target="_blank" rel="noopener">Inteiro teor (PDF) ↗</a>';
    if (links.publicacao) linksHtml += '<a href="' + esc(links.publicacao) + '" target="_blank" rel="noopener">Publicação ↗</a>';
    if (links.anexo_pdf) linksHtml += '<a href="' + esc(links.anexo_pdf) + '" target="_blank" rel="noopener">PDF da edição ↗</a>';

    return '<article class="pub-card pub-card--' + (pub.fonte === "camara" ? "camara" : "diario") + '">' +
      '<div class="pub-card__head">' +
        '<span class="pub-tag pub-tag--fonte">' + esc(fonteLabel) + "</span>" +
        '<span class="pub-tag">' + esc(pub.tipo_label || pub.tipo || "Ato") + "</span>" +
        relevanciaBadge(pub) +
        (pub.tema ? '<span class="pub-tag pub-tag--tema">' + esc(pub.tema) + "</span>" : "") +
        '<span class="pub-card__data">' + esc(dataBR(pub.data)) + "</span>" +
      "</div>" +
      '<h3 class="pub-card__titulo">' + esc(pub.titulo || "") + "</h3>" +
      (pub.autor ? '<p class="pub-card__autor">' + esc(pub.fonte === "camara" ? "Autor: " : "Órgão: ") + esc(pub.autor) + (pub.situacao ? " · " + esc(pub.situacao) : "") + "</p>" : "") +
      '<p class="pub-card__resumo">' + esc(pub.resumo || "") + "</p>" +
      bloco + pontosHtml +
      (linksHtml ? '<div class="pub-card__links">' + linksHtml + "</div>" : "") +
      "</article>";
  }

  function filtradas() {
    var q = norm(state.q);
    return state.todas.filter(function (p) {
      if (state.fonte && p.fonte !== state.fonte) return false;
      if (q) {
        var alvo = norm([p.titulo, p.resumo, p.autor, p.tema, p.tipo_label].join(" "));
        if (alvo.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function render() {
    var feed = document.getElementById("publicacoesFeed");
    var contador = document.getElementById("publicacoesContador");
    var maisBtn = document.getElementById("publicacoesMais");
    if (!feed) return;
    var lista = filtradas();
    if (contador) contador.textContent = lista.length.toLocaleString("pt-BR") + " publicação(ões)";
    var visiveis = lista.slice(0, state.offset);
    feed.innerHTML = visiveis.length
      ? visiveis.map(renderCard).join("")
      : '<p class="muted" style="padding:20px">Nenhuma publicação encontrada com esse filtro.</p>';
    if (maisBtn) {
      var resta = lista.length - visiveis.length;
      maisBtn.hidden = resta <= 0;
      maisBtn.textContent = resta > 0 ? "Carregar mais " + Math.min(POR_PAGINA, resta) + " (de " + resta + ")" : "";
    }
  }

  function init() {
    var feed = document.getElementById("publicacoesFeed");
    if (!feed || feed.dataset.ready) return;
    var D = window.ZELA_DATA || {};
    var camara = (D.publicacoes_estruturadas && D.publicacoes_estruturadas.publicacoes) || [];
    var diario = (D.publicacoes_diario && D.publicacoes_diario.publicacoes) || [];
    if (!camara.length && !diario.length) return;  // dados ainda não chegaram
    feed.dataset.ready = "1";

    state.todas = camara.concat(diario).sort(function (a, b) {
      return String(b.data || "").localeCompare(String(a.data || ""));
    });

    var busca = document.getElementById("publicacoesBusca");
    if (busca) busca.addEventListener("input", function () { state.q = busca.value; state.offset = POR_PAGINA; render(); });

    var chips = document.querySelectorAll("[data-pub-fonte]");
    chips.forEach(function (c) {
      c.addEventListener("click", function () {
        chips.forEach(function (x) { x.classList.remove("is-active"); });
        c.classList.add("is-active");
        state.fonte = c.getAttribute("data-pub-fonte");
        state.offset = POR_PAGINA;
        render();
      });
    });

    var maisBtn = document.getElementById("publicacoesMais");
    if (maisBtn) maisBtn.addEventListener("click", function () { state.offset += POR_PAGINA; render(); });

    render();
  }

  function tryInit() {
    var D = window.ZELA_DATA || {};
    if (!D.publicacoes_estruturadas && !D.publicacoes_diario) return false;
    init();
    return true;
  }

  if (!tryInit()) {
    window.addEventListener("zela:chunk", tryInit);
    document.addEventListener("DOMContentLoaded", tryInit);
  }
  window.ZELA = window.ZELA || {};
  window.ZELA.initPublicacoes = init;
})();
