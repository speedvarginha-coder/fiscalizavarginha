/* Fiscaliza Varginha — Data Loader
 *
 * Substitui o data.js monolítico (~9 MB) por chunks JSON carregados sob demanda.
 * Cada HTML especifica os chunks que precisa via <body data-chunks="a,b,c">.
 * Os chunks são fetchados em paralelo, montados em window.ZELA_DATA e o app.js
 * é carregado depois — mantendo retrocompatibilidade total.
 *
 * Fallback: se algum chunk falha (ou rodando em file:// sem servidor),
 * carrega data.js completo como antes.
 */
(function () {
  "use strict";

  // ============ CHUNKS POR PÁGINA ============
  // Mapeia data-page → chunks necessários. Body também pode sobrescrever via data-chunks.
  const CHUNKS_POR_PAGINA = {
    "home":         ["resumo", "atualizado_em", "prefeitura", "emendas", "vereadores", "pncp"],
    "prefeitura":   ["prefeitura", "emendas", "diarias", "cnpjs", "pncp", "vereadores", "atualizado_em"],
    "camara":       ["prefeitura", "emendas", "vereadores", "camara_anos", "camara_betha", "camara_transparencia", "diarias", "atualizado_em"],
    "relatorios":   ["prefeitura", "emendas", "vereadores", "resumo", "pncp", "cnpjs", "fontes_emendas_2026", "federal", "atualizado_em", "camara_anos"],
    "pessoal":      ["pessoal", "atualizado_em"],
    "marcadores":   ["prefeitura", "emendas", "atualizado_em"],
    "atualizacoes": ["atualizacoes", "prefeitura", "camara_betha", "emendas", "atualizado_em"],
    "sobre":        [],
    "cobrar":       [],
  };

  // ============ MÓDULOS DE CÓDIGO ============
  // Carregados em ordem, ANTES de app.js. app.js destrutura window.ZELA.utils etc.
  const MODULOS = [
    "modules/utils.js",
    "modules/icons.js",
    "modules/glossario.js",
    "modules/categorias.js",
    "modules/watchlist.js",
    "modules/dossie.js",
    "modules/dashboard.js",
    "modules/relatorios.js",
    "modules/diarias.js",
    "modules/atualizacoes.js",
    "modules/onboarding.js",
  ];

  const ts = Date.now();
  const body = document.body;
  const page = (body && body.dataset.page) || "home";

  // Permite override via <body data-chunks="x,y,z">
  const chunksAttr = body && body.dataset.chunks;
  const chunks = chunksAttr
    ? chunksAttr.split(",").map((s) => s.trim()).filter(Boolean)
    : (CHUNKS_POR_PAGINA[page] || []);

  // ============ HELPERS ============
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src + "?v=" + ts;
      s.charset = "UTF-8";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Falha ao carregar " + src));
      document.head.appendChild(s);
    });
  }

  function fetchChunk(key) {
    return fetch("data/chunks/" + key + ".json?v=" + ts, { cache: "default" })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((data) => ({ key, data }));
  }

  function removerOverlay() {
    const ov = document.getElementById("loading-overlay");
    if (!ov) return;
    ov.classList.add("fadeout");
    setTimeout(() => ov.remove(), 320);
  }

  // ============ MAIN ============
  async function carregar() {
    window.ZELA_DATA = window.ZELA_DATA || {};

    // Carrega lista de módulos em sequência (ordem importa)
    async function carregarModulos() {
      for (const m of MODULOS) await loadScript(m);
    }

    // Páginas sem dados (sobre, cobrar) só carregam módulos + app.js
    if (chunks.length === 0) {
      try {
        await carregarModulos();
        await loadScript("app.js");
      } catch (e) { /* sobre.html tem seu próprio script */ }
      window.dispatchEvent(new CustomEvent("zela:ready", { detail: { chunks: [] } }));
      return;
    }

    // Em file:// fetch falha — pula direto para fallback (data.js monolítico).
    if (location.protocol === "file:") {
      try {
        await loadScript("data.js");
        await carregarModulos();
        await loadScript("app.js");
        window.dispatchEvent(new CustomEvent("zela:ready", { detail: { fallback: true } }));
      } catch (e) {
        console.error("[data-loader] falha em fallback file://:", e);
      }
      return;
    }

    // Tenta carregar chunks em paralelo + módulos
    try {
      const resultados = await Promise.all(chunks.map(fetchChunk));
      resultados.forEach(({ key, data }) => {
        window.ZELA_DATA[key] = data;
      });
      await carregarModulos();
      await loadScript("app.js");
      window.dispatchEvent(new CustomEvent("zela:ready", { detail: { chunks } }));
    } catch (err) {
      console.warn("[data-loader] fallback para data.js completo. Motivo:", err.message);
      try {
        await loadScript("data.js");
        await carregarModulos();
        await loadScript("app.js");
        window.dispatchEvent(new CustomEvent("zela:ready", { detail: { fallback: true } }));
      } catch (err2) {
        console.error("[data-loader] falha total ao carregar dados:", err2);
        removerOverlay();
        if (body) {
          const aviso = document.createElement("div");
          aviso.style.cssText = "padding:40px;text-align:center;color:#c62828;font-family:sans-serif;background:#fff3e0;border-radius:8px;margin:24px;border:2px solid #f57f17";
          aviso.innerHTML = `<h3>Não foi possível carregar os dados</h3>
            <p>Se você está abrindo o painel diretamente com clique duplo (file://),
            o navegador bloqueia o carregamento dos dados.</p>
            <p><strong>Solução:</strong> rode um servidor local —
            <code style="background:#fff;padding:2px 6px;border-radius:3px">python -m http.server 8000</code>
            — e abra <code>http://localhost:8000</code></p>`;
          body.appendChild(aviso);
        }
      }
    }
  }

  // Service Worker (só funciona em http(s))
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  carregar();
})();
