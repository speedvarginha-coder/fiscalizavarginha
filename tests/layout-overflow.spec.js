const { test, expect } = require("@playwright/test");
const baseUrl = process.env.LAYOUT_BASE_URL || "http://127.0.0.1:4173";

const pages = [
  "index.html",
  "atualizacoes.html",
  "prefeitura.html",
  "prefeitura.html?tab=diarias&ano=2026#diarias",
  "prefeitura.html?tab=contratos",
  "prefeitura.html?tab=asfalto",
  "fundacao.html",
  "camara.html",
  "emendas/index.html",
  "relatorios.html",
  "pessoal.html",
  "avalie.html",
  "sobre.html",
  "conformidade.html",
  "cobrar.html",
];

const viewports = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

for (const viewport of viewports) {
  test(`sem quebra horizontal visível em ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const problemas = [];

    for (const path of pages) {
      await page.goto(`${baseUrl}/${path}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(path.includes("prefeitura") ? 1800 : 700);
      if (["prefeitura.html", "camara.html", "relatorios.html"].includes(path)) {
        await expect(page.locator(".source-coverage")).toBeVisible({ timeout: 15_000 });
        await expect(page.locator(".source-coverage summary")).toContainText("Cobertura dos dados");
      }
      if (path === "prefeitura.html") {
        await expect(page.getByText("Baixar relatório em PDF", { exact: true })).toHaveCount(1);
      }
      if (path === "relatorios.html") {
        await expect(page.locator("#pontosConferencia .verification-item").first()).toBeVisible();
        await expect(page.locator("#pontosConferencia > .verification-item")).toHaveCount(4);
        await expect(page.locator("#pontosConferencia > .verification-more")).toBeVisible();
        if (viewport.width === 1280) {
          await page.locator("#pontos-conferencia").screenshot({
            path: "test-results/layout-pontos-conferencia-1280.png",
            animations: "disabled",
          });
        }
      }
      if (viewport.width === 1280 && path === "prefeitura.html") {
        await page.locator("#prefeituraResumoTopo").screenshot({
          path: "test-results/layout-prefeitura-resumo-1280.png",
          animations: "disabled",
        });
      }
      if (path.includes("tab=asfalto")) {
        await expect(page.locator("#filtroOrdemAsfalto")).toHaveValue("inicio");
        await expect(page.locator("#badgeAsfalto")).toHaveText(/^\d/);
        const datasVisiveis = await page.locator(".asfalto-card__grid").evaluateAll((grids) =>
          grids.map((grid) => {
            const texto = [...grid.querySelectorAll("span")]
              .map((span) => span.textContent || "")
              .find((valor) => valor.trim().startsWith("Data:")) || "";
            const partes = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            return partes ? `${partes[3]}-${partes[2]}-${partes[1]}` : "";
          }).filter(Boolean)
        );
        expect(datasVisiveis).toEqual([...datasVisiveis].sort().reverse());
      }
      if (viewport.width === 1280 && path.includes("tab=diarias")) {
        await page.locator("#statsDiariasPrefeitura").screenshot({
          path: "test-results/layout-prefeitura-valores-1280.png",
          animations: "disabled",
        });
        await page.locator(".pref-tabs").screenshot({
          path: "test-results/layout-prefeitura-tabs-1280.png",
          animations: "disabled",
        });
        await page.locator("#diariasPrefeituraBlock .filterbar").screenshot({
          path: "test-results/layout-prefeitura-filtros-1280.png",
          animations: "disabled",
        });
      }

      const resultado = await page.evaluate(() => {
        const raiz = document.documentElement;
        const visivel = (el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 1 && r.height > 1 && s.display !== "none" && s.visibility !== "hidden";
        };
        const seletor = (el) => {
          const id = el.id ? `#${el.id}` : "";
          const classes = [...el.classList].slice(0, 3).map((c) => `.${c}`).join("");
          return `${el.tagName.toLowerCase()}${id}${classes}`;
        };

        const rolagemIntencional = (el) =>
          el.matches(".cat-chips, .lvb-chips, .quick-filters, .chart-bars, .fonte-table-wrap")
          || (innerWidth <= 760 && el.matches(".pref-tabs"))
          || !!el.querySelector(":scope > table");

        const scrollInterno = [...document.querySelectorAll("body *")]
          .filter(visivel)
          .filter((el) => el.scrollWidth > el.clientWidth + 3)
          .filter((el) => ["auto", "scroll"].includes(getComputedStyle(el).overflowX))
          .filter((el) => !rolagemIntencional(el))
          .map((el) => ({
            seletor: seletor(el),
            pai: el.parentElement ? seletor(el.parentElement) : "",
            texto: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 100),
            clientWidth: el.clientWidth,
            scrollWidth: el.scrollWidth,
          }));

        const foraDaTela = [...document.querySelectorAll("body *")]
          .filter(visivel)
          .map((el) => ({ el, rect: el.getBoundingClientRect() }))
          .filter(({ rect }) => rect.right > innerWidth + 3 || rect.left < -3)
          .slice(0, 12)
          .map(({ el, rect }) => ({
            seletor: seletor(el),
            pai: el.parentElement ? seletor(el.parentElement) : "",
            texto: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 100),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          }));

        return {
          larguraDocumento: raiz.scrollWidth - raiz.clientWidth,
          scrollInterno,
          foraDaTela,
        };
      });

      if (resultado.larguraDocumento > 3 || resultado.scrollInterno.length) {
        problemas.push({ path, ...resultado });
      }
    }

    console.log(`AUDITORIA_LAYOUT_${viewport.width}=${JSON.stringify(problemas)}`);
    expect(problemas, JSON.stringify(problemas, null, 2)).toEqual([]);
  });
}
