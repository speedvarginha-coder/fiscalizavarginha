/* Zela Varginha — modules/watchlist.js
 *
 * Watchlist cidadã — marcadores pessoais em localStorage.
 *
 * Disponível em window.ZELA.watchlist.
 * Carregado pelo data-loader.js (depois de utils.js, antes de app.js).
 *
 * Dependências externas:
 *   - window.ZELA.utils.* (esc, jsSafe, norm — conforme uso interno)
 */
(function () {
  "use strict";
  window.ZELA = window.ZELA || {};
  // Aliases das utilidades. utils.js DEVE ser carregado antes.
  const u = window.ZELA.utils;
  if (!u) {
    console.error("[watchlist] window.ZELA.utils ausente. Carregue modules/utils.js primeiro.");
    return;
  }
  const esc = u.esc, jsSafe = u.jsSafe, norm = u.norm;

  // ============= WATCHLIST CIDADÃ =============
  const WATCH_KEY = "zela.watchlist.v1";
  const carregarWatch = function () {
    try {
      const raw = localStorage.getItem(WATCH_KEY);
      if (!raw) return { contratos: [], emendas: [] };
      const obj = JSON.parse(raw);
      return {
        contratos: Array.isArray(obj.contratos) ? obj.contratos : [],
        emendas:   Array.isArray(obj.emendas)   ? obj.emendas   : [],
      };
    } catch (e) { return { contratos: [], emendas: [] }; }
  };
  const salvarWatch = function (w) {
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(w)); }
    catch (e) { /* localStorage cheio ou bloqueado — silencioso */ }
  };
  window.ZELA.watchlist = {
    obter: carregarWatch,
    has: function (tipo, id) {
      const w = carregarWatch();
      return (w[tipo] || []).indexOf(id) >= 0;
    },
    toggle: function (tipo, id) {
      const w = carregarWatch();
      const arr = w[tipo] || [];
      const i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1); else arr.push(id);
      w[tipo] = arr;
      salvarWatch(w);
      // Atualiza visualmente todos os botões com esse ID
      document.querySelectorAll(`.btn-star[data-watch-tipo="${tipo}"][data-watch-id="${id}"]`).forEach(b => {
        b.classList.toggle("is-marked", arr.indexOf(id) >= 0);
        b.setAttribute("aria-pressed", arr.indexOf(id) >= 0 ? "true" : "false");
        b.title = arr.indexOf(id) >= 0 ? "Remover dos marcadores" : "Adicionar aos marcadores";
      });
      // Atualiza contador na nav (se existir)
      const cnt = document.getElementById("watchCount");
      if (cnt) {
        const total = (w.contratos.length + w.emendas.length);
        cnt.textContent = total > 0 ? String(total) : "";
      }
      return arr.indexOf(id) >= 0;
    },
    botao: function (tipo, id) {
      const marked = window.ZELA.watchlist.has(tipo, id);
      return `<button type="button" class="btn-star${marked ? " is-marked" : ""}"
        data-watch-tipo="${tipo}" data-watch-id="${esc(id)}"
        aria-pressed="${marked ? "true" : "false"}"
        title="${marked ? "Remover dos marcadores" : "Adicionar aos marcadores"}"
        aria-label="${marked ? "Remover" : "Adicionar"} marcador"
        onclick="window.ZELA.watchlist.toggle('${tipo}', '${jsSafe(id)}')">${marked ? "★" : "☆"}</button>`;
    }
  };
  // Atualiza contador da nav quando o app carrega
  (function () {
    const w = carregarWatch();
    const total = w.contratos.length + w.emendas.length;
    const cnt = document.getElementById("watchCount");
    if (cnt && total > 0) cnt.textContent = String(total);
  })();
  // Atualiza estrela quando botão é clicado (delegação para usuários sem JS inline)
  document.addEventListener("click", function (e) {
    const btn = e.target.closest && e.target.closest(".btn-star[data-watch-tipo]");
    if (!btn || btn.dataset.handled === "1") return;
    // se onclick inline não existir, faz aqui
    if (!btn.getAttribute("onclick")) {
      window.ZELA.watchlist.toggle(btn.dataset.watchTipo, btn.dataset.watchId);
    }
  });


})();
