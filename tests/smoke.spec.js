// @ts-check
/**
 * Smoke tests — Fiscaliza Varginha
 *
 * Objetivo: garantir que cada página HTML abre, executa app.js sem erro
 * crítico no console, e renderiza pelo menos um bloco principal.
 *
 * Estes testes NÃO substituem QA manual. Pegam regressões básicas:
 *   - JS quebrado (ReferenceError, TypeError)
 *   - Strings hard-coded vazias
 *   - data.js não carregando
 *   - Blocos principais desaparecendo
 */
const { test, expect } = require("@playwright/test");
const path = require("path");

const PAINEL = path.resolve(__dirname, "..", "painel-cidadao");
const fileUrl = (page) => "file:///" + path.join(PAINEL, page).replace(/\\/g, "/");

/** Coleta erros do console — ignora limitações de file:// (não-bugs do app). */
const BENIGNOS = [
  /favicon/,
  /net::ERR_FILE_NOT_FOUND.*\.json/,
  /ServiceWorker.*protocol.*not supported/i,  // SW só funciona em http(s)
  /Failed to register a ServiceWorker.*null/i,
  /URL protocol of the current origin/i,
];
function setupConsoleListener(page) {
  const erros = [];
  const isBenign = (txt) => BENIGNOS.some((r) => r.test(txt));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const txt = msg.text();
      if (isBenign(txt)) return;
      erros.push(txt);
    }
  });
  page.on("pageerror", (err) => {
    if (isBenign(err.message)) return;
    erros.push("UNCAUGHT: " + err.message);
  });
  return erros;
}

const PAGINAS = [
  { arquivo: "index.html",      titulo: /Fiscaliza Varginha/,           bloco: "footer" },
  { arquivo: "prefeitura.html", titulo: /Prefeitura/,              bloco: "#placarPrefeitura" },
  { arquivo: "camara.html",     titulo: /Câmara/,                  bloco: "#placarCamara" },
  { arquivo: "relatorios.html", titulo: /Relatórios/,              bloco: "#prioridades-fiscalização" },
  { arquivo: "pessoal.html",    titulo: /Pessoal/,                 bloco: "#listaPessoal" },
  { arquivo: "sobre.html",      titulo: /Sobre/,                   bloco: "#tabelaGlossario" },
  { arquivo: "cobrar.html",     titulo: /Como cobrar/,             bloco: ".cobrar-blocks" },
  { arquivo: "marcadores.html", titulo: /Marcadores/,              bloco: "#marcadoresArea" },
  { arquivo: "atualizacoes.html", titulo: /Atualizações/,           bloco: "#atualizacoesFeed" },
];

for (const p of PAGINAS) {
  test.describe(`Página: ${p.arquivo}`, () => {
    test("abre sem erro fatal no console", async ({ page }) => {
      const erros = setupConsoleListener(page);
      await page.goto(fileUrl(p.arquivo), { waitUntil: "domcontentloaded" });
      // Espera app.js terminar de inicializar (overlay de loading some)
      await page.waitForFunction(
        () => !document.getElementById("loading-overlay") ||
              document.getElementById("loading-overlay").classList.contains("fadeout"),
        { timeout: 15_000 }
      ).catch(() => { /* algumas páginas não têm overlay */ });
      // Pausa breve para qualquer erro tardio aparecer
      await page.waitForTimeout(500);
      expect(erros, "Erros no console:\n" + erros.join("\n")).toEqual([]);
    });

    test("tem o título correto", async ({ page }) => {
      await page.goto(fileUrl(p.arquivo));
      await expect(page).toHaveTitle(p.titulo);
    });

    test(`bloco principal aparece (${p.bloco})`, async ({ page }) => {
      await page.goto(fileUrl(p.arquivo), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500); // dá tempo do app.js renderizar
      const el = page.locator(p.bloco).first();
      await expect(el, `Bloco ${p.bloco} não foi encontrado`).toBeAttached();
    });
  });
}

test.describe("Navegação", () => {
  test("nav contém todos os links principais", async ({ page }) => {
    await page.goto(fileUrl("index.html"));
    const links = [
      "index.html", "prefeitura.html", "camara.html",
      "relatorios.html", "pessoal.html", "marcadores.html",
      "atualizacoes.html", "sobre.html", "cobrar.html",
    ];
    for (const href of links) {
      await expect(page.locator(`nav a[href="${href}"]`).first()).toBeAttached();
    }
  });
});

test.describe("Filtros básicos", () => {
  test("Prefeitura — filtro de busca aceita texto", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    // Vai para aba contratos
    await page.locator('[data-pref-tab="contratos"]').first().click();
    const busca = page.locator("#filtroContrato");
    await expect(busca).toBeAttached();
    await busca.fill("teste");
    await expect(busca).toHaveValue("teste");
  });

  test("Prefeitura — busca por número abre detalhes e fonte", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.locator('[data-pref-tab="contratos"]').first().click();
    const busca = page.locator("#filtroContrato");
    await busca.fill("2/2026");
    await expect(busca).toHaveValue("2/2026");
    await expect(page.locator("#contratos .contrato").first()).toBeAttached();
    await page.locator("#contratos .btn-dossie", { hasText: "Ver detalhes e fonte" }).first().click();
    const modal = page.locator("#modalFiscaliza");
    await expect(modal).toBeAttached();
    await expect(modal.locator("text=CONFERÊNCIA DE PROCEDÊNCIA")).toBeVisible();
    await expect(modal.locator("text=Abrir tabela Betha")).toBeVisible();
    await expect(modal.locator("text=Buscar no PNCP")).toBeVisible();
  });

  test("Prefeitura — maiores registros da visão geral abrem contrato", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const row = page.locator("#gastosPalavraChave .keyword-row--button").first();
    await expect(row).toBeVisible();
    await expect(row.locator("text=Ver contrato")).toBeVisible();
    await row.click();
    const modal = page.locator("#modalFiscaliza");
    await expect(modal).toBeAttached();
    await expect(modal.locator("text=CONFERÊNCIA DE PROCEDÊNCIA")).toBeVisible();
  });

  test("Câmara — filtro de emendas aceita texto", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const busca = page.locator("#filtroEm");
    await expect(busca).toBeAttached();
    await busca.fill("teste");
    await expect(busca).toHaveValue("teste");
  });
});

test.describe("Placar do dinheiro", () => {
  test("Prefeitura mostra 4 cards no placar", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const cards = page.locator("#placarPrefeitura .placar-card");
    await expect(cards).toHaveCount(4);
  });

  test("Câmara mostra 4 cards no placar", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const cards = page.locator("#placarCamara .placar-card");
    await expect(cards).toHaveCount(4);
  });
});

test.describe("Atualizações diárias (feed)", () => {
  test("Feed renderiza contratos reais coletados do Betha", async ({ page }) => {
    await page.goto(fileUrl("atualizacoes.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const cards = page.locator("#atualizacoesFeed .tline-item");
    // Espera pelo menos 1 ato (contratos reais de Varginha vindos dos dados Betha)
    await expect(cards.first()).toBeAttached();
  });

  test("Stats no topo mostram 4 cards", async ({ page }) => {
    await page.goto(fileUrl("atualizacoes.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const stats = page.locator("#atualizacoesStats .placar-card");
    await expect(stats).toHaveCount(4);
  });

  test("Filtro Câmara mostra contratos (regressão: chunk camara_betha)", async ({ page }) => {
    await page.goto(fileUrl("atualizacoes.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    // Clica no chip Câmara
    await page.locator('#atualizacoesFiltros .cat-chip[data-valor="Câmara"]').click();
    await page.waitForTimeout(300);
    // Espera pelo menos 1 card de Câmara aparecer (deveria ter 36 contratos reais)
    const cards = page.locator("#atualizacoesFeed .tline-item");
    await expect(cards.first()).toBeAttached();
    // Empty state NÃO deve aparecer
    const empty = page.locator("#atualizacoesEmpty");
    await expect(empty).toBeHidden();
  });

  test("Filtro de busca responde", async ({ page }) => {
    await page.goto(fileUrl("atualizacoes.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const busca = page.locator("#filtroAtualizacoes");
    await busca.fill("inexistente_xyz_123");
    await page.waitForTimeout(300);
    const empty = page.locator("#atualizacoesEmpty");
    await expect(empty).toBeVisible();
  });
});

test.describe("Aba Diárias (regressão)", () => {
  test("Prefeitura — aba Diárias mostra bloco no DOM", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.locator('.pref-tab[data-pref-tab="diarias"]').first().click();
    await page.waitForTimeout(500);
    // Bloco principal de diárias precisa estar no DOM (ID sem acento)
    const block = page.locator("#diariasPrefeituraBlock");
    await expect(block).toBeAttached();
  });

  test("Câmara — aba Diárias mostra bloco no DOM", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const block = page.locator("#diariasCamaraBlock");
    await expect(block).toBeAttached();
  });
});

test.describe("Per-capita no placar", () => {
  test("Prefeitura mostra valor por morador no card de total", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const pc = page.locator("#placarPrefeitura .placar-card__percapita").first();
    await expect(pc).toContainText("por morador");
  });
});

test.describe("Banner de boas-vindas (onboarding)", () => {
  test("aparece na primeira visita e some ao fechar", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("fiscaliza.onboarding.v1"));
    await page.reload();
    await page.waitForTimeout(2000);
    const banner = page.locator("#onboarding-banner");
    await expect(banner).toBeVisible();
    await banner.locator(".onboarding__close").click();
    await page.waitForTimeout(400);
    await expect(banner).toHaveCount(0);
    // Não reaparece após recarregar (flag persistida)
    await page.reload();
    await page.waitForTimeout(2000);
    await expect(page.locator("#onboarding-banner")).toHaveCount(0);
  });
});

test.describe("Classificação cidadã de matérias", () => {
  test("dados têm grau/tema e materiaCard rendeza selo + por que acompanhar", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const anos = (window.ZELA_DATA && window.ZELA_DATA.camara_anos) || {};
      const ano = Object.keys(anos)[0];
      const mats = (anos[ano] && anos[ano].materias) || [];
      const classificadas = mats.filter((m) => m.grau && m.tema).length;
      // Card de uma matéria de alto impacto, se houver
      const esc = (s) => String(s == null ? "" : s);
      const alta = mats.find((m) => m.grau === "alto") || mats[0];
      const html = window.ZELA.materiaCard ? window.ZELA.materiaCard(alta, esc) : "";
      return { total: mats.length, classificadas, grau: alta && alta.grau, html };
    });
    expect(r.total).toBeGreaterThan(0);
    expect(r.classificadas).toBe(r.total); // todas classificadas
    expect(r.html).toContain("mat-selo");
    expect(r.html).toMatch(/Por que acompanhar|Classificada como simbólica/);
  });
});

test.describe("Resumo Semanal", () => {
  test("bloco renderiza e mostra matérias ou estado vazio", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const block = page.locator("#resumoSemanalBlock");
    await expect(block).toBeAttached();
    // Feed ou empty-state — um dos dois está visível
    const feed = page.locator("#resumoSemanalFeed");
    const empty = page.locator("#resumoSemanalEmpty");
    const feedVisible  = await feed.isVisible().catch(() => false);
    const emptyVisible = await empty.isVisible().catch(() => false);
    expect(feedVisible || emptyVisible).toBeTruthy();
  });

  test("filtro de período 'Este mês' retorna matérias", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.locator('#resumoPeriodoChips .cat-chip[data-periodo="mes"]').click();
    await page.waitForTimeout(300);
    const counter = page.locator("#resumoContador");
    await expect(counter).toBeAttached();
  });

  test("chips de grau filtram por impacto", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    // Primeiro expande para 'Este mês' para ter dados
    await page.locator('#resumoPeriodoChips .cat-chip[data-periodo="mes"]').click();
    await page.waitForTimeout(300);
    // Filtra só ALTO
    await page.locator('#resumoGrauChips .cat-chip[data-grau="alto"]').click();
    await page.waitForTimeout(300);
    // Não deve haver erro no console (já coberto por smoke geral)
    const counter = page.locator("#resumoContador");
    await expect(counter).toBeAttached();
  });
});

test.describe("Watchlist", () => {
  test("estado vazio aparece quando localStorage não tem nada", async ({ page }) => {
    await page.goto(fileUrl("marcadores.html"), { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("zela.watchlist.v1"));
    await page.reload();
    await page.waitForTimeout(2000);
    const vazio = page.locator(".marcadores-vazio");
    await expect(vazio).toBeAttached();
  });
});
