/* Fiscaliza Varginha — Data Loader
 *
 * Substitui o data.js monolítico (~9 MB) por chunks JSON carregados sob demanda.
 * Cada HTML especifica os chunks que precisa via <body data-chunks="a,b,c">.
 * Os chunks são fetchados em paralelo, montados em window.FISCALIZA_DATA e o app.js
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
    "home":         ["home_resumo", "resumo", "atualizado_em", "auditoria_dados", "status_fontes", "prefeitura", "camara_betha", "emendas", "vereadores", "pncp", "sancoes_fornecedores", "diario"],
    "prefeitura":   ["prefeitura", "emendas", "diarias", "cnpjs", "pncp", "sancoes_fornecedores", "vereadores", "atualizado_em", "diario", "auditoria_dados", "status_fontes"],
    "fundacao":     ["fundacao_cultural", "atualizado_em", "auditoria_dados", "status_fontes", "diario", "prefeitura", "camara_betha"],
    "camara":       ["prefeitura", "emendas", "vereadores", "camara_anos", "indice_relevancia", "camara_betha", "camara_transparencia", "remuneracao_vereadores", "pessoal", "diarias", "pncp", "sancoes_fornecedores", "atualizado_em", "auditoria_dados", "status_fontes"],
    // "receitas" removido: o chunk mistura arrecadação acumulada de vários anos
    // (ISSQN R$ 2,1 bi vs orçado 379M) e nada na página o renderiza — não publicar
    // até a coleta filtrar o exercício corrente.
    "relatorios":   ["prefeitura", "emendas", "vereadores", "resumo", "pncp", "sancoes_fornecedores", "cnpjs", "fontes_emendas_2026", "federal", "atualizado_em", "camara_anos", "auditoria_dados", "status_fontes", "pessoal", "licitacoes_resultados"],
    "pessoal":      ["atualizado_em", "auditoria_dados"],  // pessoal.json auto-carregado por initPessoal()
    "marcadores":   ["prefeitura", "emendas", "atualizado_em", "auditoria_dados"],
    "atualizacoes": ["prefeitura", "camara_betha", "emendas", "diario", "mudancas_coleta", "atualizado_em", "auditoria_dados", "publicacoes_estruturadas", "publicacoes_diario"],
    "sobre":        ["atualizado_em", "auditoria_dados"],
    "cobrar":       ["prefeitura", "camara_betha", "emendas", "pncp", "sancoes_fornecedores", "diario", "pessoal", "remuneracao_vereadores", "atualizado_em", "auditoria_dados"],
  };

  // Chunks pesados adiados para 2ª fase por página: carregam APÓS app.js renderizar
  // app.js escuta "fiscaliza:chunk" e re-renderiza as seções afetadas
  const CHUNKS_FASE2 = {
    "home": ["prefeitura"],  // 4.4 MB — home usa só resumo; prefeitura.json chega depois
    "fundacao": ["prefeitura", "camara_betha"],  // p/ cruzar fornecedores entre esferas (chegam após o render)
    // 687 KB só para o sinal de preço homologado × estimado: não pode atrasar
    // o primeiro render dos relatórios. app.js re-renderiza quando chega.
    "relatorios": ["licitacoes_resultados"],
  };

  // Bases grandes carregadas somente quando a seção correspondente for usada.
  // Diferente da fase 2, elas não iniciam automaticamente após o primeiro render.
  const CHUNKS_SOB_DEMANDA = {
    "prefeitura": ["diarias"],
    "camara": ["diarias"],
  };

  // ============ MÓDULOS DE CÓDIGO ============
  // Carregados em ordem, ANTES de app.js. app.js destrutura window.FISCALIZA.utils etc.
  const MODULOS = [
    "modules/utils.js",
    "modules/icons.js",
    "modules/glossario.js",
    "modules/categorias.js",
    "modules/watchlist.js",
    "modules/dossie.js",
    "modules/dashboard.js",
    "modules/home-cidadao.js",
    "modules/relatorios.js",
    "modules/diarias.js",
    "modules/atualizacoes.js",
    "modules/materia-cidada.js",
    "modules/indice-relevancia.js",
    "modules/onboarding.js",
    "modules/chat-cidadao.js",
    "modules/publicacoes.js",
  ];

  // A home é a principal porta de entrada no celular. Antes ela baixava todos
  // os módulos das páginas internas (diárias, relatórios, atualizações etc.)
  // antes de liberar a tela, embora não os utilizasse.
  const MODULOS_POR_PAGINA = {
    "home": [
      "modules/utils.js",
      "modules/icons.js",
      "modules/glossario.js",
      "modules/categorias.js",
      "modules/dossie.js",
      "modules/home-cidadao.js",
      "modules/onboarding.js",
    ],
    "prefeitura": [
      "modules/utils.js", "modules/icons.js", "modules/glossario.js",
      "modules/categorias.js", "modules/watchlist.js", "modules/dossie.js",
      "modules/dashboard.js", "modules/diarias.js", "modules/onboarding.js",
    ],
    "camara": [
      "modules/utils.js", "modules/icons.js", "modules/glossario.js",
      "modules/categorias.js", "modules/watchlist.js", "modules/dossie.js",
      "modules/dashboard.js", "modules/diarias.js", "modules/materia-cidada.js",
      "modules/indice-relevancia.js", "modules/onboarding.js",
    ],
    "relatorios": [
      "modules/utils.js", "modules/icons.js", "modules/glossario.js",
      "modules/categorias.js", "modules/dossie.js", "modules/relatorios.js",
      "modules/onboarding.js",
    ],
    "atualizacoes": [
      "modules/utils.js", "modules/icons.js", "modules/glossario.js",
      "modules/atualizacoes.js", "modules/publicacoes.js",
    ],
    "pessoal": ["modules/utils.js", "modules/icons.js", "modules/glossario.js", "modules/dossie.js", "modules/onboarding.js"],
    "fundacao": ["modules/utils.js", "modules/icons.js", "modules/glossario.js", "modules/categorias.js", "modules/dossie.js", "modules/dashboard.js", "modules/onboarding.js"],
    "marcadores": ["modules/utils.js", "modules/icons.js", "modules/glossario.js", "modules/watchlist.js", "modules/dossie.js"],
    "cobrar": ["modules/utils.js", "modules/icons.js", "modules/glossario.js", "modules/dossie.js"],
    "sobre": ["modules/utils.js", "modules/icons.js", "modules/glossario.js"],
  };
  const MODULOS_ADIADOS_POR_PAGINA = {
    "home": ["modules/chat-cidadao.js"],
    "prefeitura": ["modules/chat-cidadao.js"],
    "camara": ["modules/chat-cidadao.js"],
    "relatorios": ["modules/chat-cidadao.js"],
    "fundacao": ["modules/chat-cidadao.js"],
    "cobrar": ["modules/chat-cidadao.js"],
  };

  // Versão estável: Date.now() obrigava o celular a baixar novamente todos os
  // scripts e chunks em cada visita. A versão muda apenas quando há deploy.
  const BUILD_VERSION = "20260730-pipeline1";
  const body = document.body;
  const page = (body && body.dataset.page) || "home";
  const modulosPagina = MODULOS_POR_PAGINA[page] || MODULOS;
  const modulosAdiados = MODULOS_ADIADOS_POR_PAGINA[page] || [];

  // Permite override via <body data-chunks="x,y,z">
  const chunksAttr = body && body.dataset.chunks;
  const chunks = chunksAttr
    ? chunksAttr.split(",").map((s) => s.trim()).filter(Boolean)
    : (CHUNKS_POR_PAGINA[page] || []);

  const chunksSobDemanda = new Set(CHUNKS_SOB_DEMANDA[page] || []);
  const cargasEmAndamento = new Map();

  // ============ HELPERS ============
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src + "?v=" + BUILD_VERSION;
      s.charset = "UTF-8";
      // Scripts dinâmicos são async por padrão. Desativar async permite que o
      // navegador baixe em paralelo, mas execute na ordem da lista.
      s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Falha ao carregar " + src));
      document.head.appendChild(s);
    });
  }

  // Chunks opcionais (novos): falha silenciosa, não derruba toda a página
  const CHUNKS_OPCIONAIS = new Set(["atualizacoes", "receitas", "publicacoes_estruturadas", "publicacoes_diario"]);

  function fetchChunk(key) {
    // URL estável permite ao service worker devolver o cache imediatamente e
    // revalidar em segundo plano. "no-cache" ainda consulta a versão nova
    // quando não há service worker, usando ETag/Last-Modified.
    return fetch("data/chunks/" + key + ".json", { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((data) => ({ key, data }))
      .catch((err) => {
        if (CHUNKS_OPCIONAIS.has(key)) {
          console.info("[data-loader] chunk opcional ausente:", key, err.message);
          return { key, data: null };
        }
        throw err;
      });
  }

  function carregarChunkSobDemanda(key) {
    if (!chunksSobDemanda.has(key)) return Promise.resolve(window.FISCALIZA_DATA?.[key]);
    if (window.FISCALIZA_DATA && window.FISCALIZA_DATA[key] != null) {
      return Promise.resolve(window.FISCALIZA_DATA[key]);
    }
    if (cargasEmAndamento.has(key)) return cargasEmAndamento.get(key);

    window.dispatchEvent(new CustomEvent("fiscaliza:chunk:start", { detail: { key, page } }));
    document.body?.setAttribute("data-chunk-loading", key);
    const carga = fetchChunk(key)
      .then(({ data }) => {
        window.FISCALIZA_DATA = window.FISCALIZA_DATA || {};
        window.FISCALIZA_DATA[key] = data;
        document.body?.removeAttribute("data-chunk-loading");
        document.body?.setAttribute(`data-chunk-${key}`, "ready");
        window.dispatchEvent(new CustomEvent("fiscaliza:chunk", { detail: { key, page, demand: true } }));
        return data;
      })
      .catch((error) => {
        document.body?.removeAttribute("data-chunk-loading");
        document.body?.setAttribute(`data-chunk-${key}`, "error");
        window.dispatchEvent(new CustomEvent("fiscaliza:chunk:error", { detail: { key, page, error } }));
        throw error;
      })
      .finally(() => cargasEmAndamento.delete(key));

    cargasEmAndamento.set(key, carga);
    return carga;
  }

  window.FISCALIZA_DATA_LOADER = Object.freeze({
    load: carregarChunkSobDemanda,
    isDeferred: (key) => chunksSobDemanda.has(key),
    isLoaded: (key) => Boolean(window.FISCALIZA_DATA && window.FISCALIZA_DATA[key] != null),
  });

  function prepararGatilhosSobDemanda() {
    if (!chunksSobDemanda.size) return;
    document.body?.setAttribute("data-progressive-data", Array.from(chunksSobDemanda).join(","));

    document.addEventListener("click", (event) => {
      const trigger = event.target.closest?.('[data-pref-tab="diarias"]');
      if (trigger && chunksSobDemanda.has("diarias")) {
        carregarChunkSobDemanda("diarias").catch(() => {});
      }
    });

    const params = new URLSearchParams(location.search);
    if ((params.get("tab") === "diarias" || location.hash.includes("diarias")) && chunksSobDemanda.has("diarias")) {
      carregarChunkSobDemanda("diarias").catch(() => {});
    }

    const observar = () => {
      const id = page === "camara" ? "diariasCamaraBlock" : "diariasPrefeituraBlock";
      const bloco = document.getElementById(id);
      if (!bloco || !chunksSobDemanda.has("diarias") || !("IntersectionObserver" in window)) return;
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        carregarChunkSobDemanda("diarias").catch(() => {});
      }, { rootMargin: "700px 0px" });
      observer.observe(bloco);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observar, { once: true });
    else observar();
  }

  prepararGatilhosSobDemanda();

  function removerOverlay() {
    const ov = document.getElementById("loading-overlay");
    if (!ov) return;
    ov.classList.add("fadeout");
    setTimeout(() => ov.remove(), 320);
  }

  // ============ MAIN ============
  async function carregar() {
    window.FISCALIZA_DATA = window.FISCALIZA_DATA || {};

    // Insere todos em ordem de uma vez: downloads paralelos, execução ordenada
    // por async=false em loadScript().
    async function carregarModulos() {
      await Promise.all(modulosPagina.map(loadScript));
    }

    function carregarModulosAdiados() {
      if (!modulosAdiados.length) return;
      const iniciar = () => Promise.allSettled(modulosAdiados.map(loadScript));
      if ("requestIdleCallback" in window) {
        requestIdleCallback(iniciar, { timeout: 2500 });
      } else {
        setTimeout(iniciar, 800);
      }
    }

    // Páginas sem dados só carregam módulos + app.js
    if (chunks.length === 0) {
      try {
        await carregarModulos();
        await loadScript("app.js");
      } catch (e) { /* sobre.html tem seu próprio script */ }
      window.dispatchEvent(new CustomEvent("fiscaliza:ready", { detail: { chunks: [] } }));
      return;
    }

    // Em file:// fetch falha — pula direto para fallback (data.js monolítico).
    if (location.protocol === "file:") {
      try {
        await loadScript("data.js");
        await carregarModulos();
        await loadScript("app.js");
        window.dispatchEvent(new CustomEvent("fiscaliza:ready", { detail: { fallback: true } }));
      } catch (e) {
        console.error("[data-loader] falha em fallback file://:", e);
      }
      return;
    }

    // Tenta carregar chunks em paralelo + módulos
    try {
      // Separa chunks críticos (fase 1) dos pesados adiados (fase 2)
      const fase2Keys = new Set(CHUNKS_FASE2[page] || []);
      const chunksFase1 = chunks.filter(k => !fase2Keys.has(k) && !chunksSobDemanda.has(k));
      const chunksFase2 = chunks.filter(k => fase2Keys.has(k) && !chunksSobDemanda.has(k));

      const resultados = await Promise.all(chunksFase1.map(fetchChunk));
      resultados.forEach(({ key, data }) => { window.FISCALIZA_DATA[key] = data; });

      await carregarModulos();
      await loadScript("app.js");
      window.dispatchEvent(new CustomEvent("fiscaliza:ready", { detail: { chunks } }));
      carregarModulosAdiados();

      // Fase 2: chunks pesados carregam em background sem bloquear o render inicial
      if (chunksFase2.length > 0) {
        Promise.allSettled(chunksFase2.map(fetchChunk)).then(results => {
          results.forEach(r => {
            if (r.status === "fulfilled" && r.value && r.value.data !== null) {
              window.FISCALIZA_DATA[r.value.key] = r.value.data;
              window.dispatchEvent(new CustomEvent("fiscaliza:chunk", { detail: { key: r.value.key } }));
            }
          });
        });
      }
    } catch (err) {
      console.warn("[data-loader] fallback para data.js completo. Motivo:", err.message);
      try {
        await loadScript("data.js");
        await carregarModulos();
        await loadScript("app.js");
        window.dispatchEvent(new CustomEvent("fiscaliza:ready", { detail: { fallback: true } }));
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

  // Na home, a maior parte do conteúdo é HTML estático e já pode ser usada
  // enquanto os números vivos terminam de carregar. O overlay não deve cobrir
  // uma página que o navegador já renderizou.
  if (page === "home") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", removerOverlay, { once: true });
    } else {
      removerOverlay();
    }
  }

  carregar();
})();
