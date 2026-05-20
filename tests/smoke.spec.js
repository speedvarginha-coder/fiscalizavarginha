// @ts-check
/**
 * Smoke tests — Zela Varginha
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
  { arquivo: "index.html",      titulo: /Zela Varginha/,           bloco: "footer" },
  { arquivo: "prefeitura.html", titulo: /Prefeitura/,              bloco: "#placarPrefeitura" },
  { arquivo: "camara.html",     titulo: /Câmara/,                  bloco: "#placarCamara" },
  { arquivo: "relatorios.html", titulo: /Relatórios/,              bloco: "#prioridades-fiscalização" },
  { arquivo: "pessoal.html",    titulo: /Pessoal/,                 bloco: "#listaPessoal" },
  { arquivo: "sobre.html",      titulo: /Sobre/,                   bloco: "#tabelaGlossario" },
  { arquivo: "cobrar.html",     titulo: /Como cobrar/,             bloco: ".cobrar-blocks" },
  { arquivo: "marcadores.html", titulo: /Marcadores/,              bloco: "#marcadoresArea" },
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
      "sobre.html", "cobrar.html",
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
