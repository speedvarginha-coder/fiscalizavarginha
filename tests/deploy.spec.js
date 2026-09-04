const { test, expect } = require("@playwright/test");

test("pacote entrega emendas corrigidas e a referência documental", async ({ page, request }) => {
  const reference = await request.get("/data/referencias/emendas-municipais-documentos.json");
  expect(reference.ok()).toBe(true);
  expect((await reference.json()).emendas).toHaveLength(357);
  await page.goto("/emendas/");
  const cacheVersion = (await (await request.get("/sw.js")).text()).match(/const CACHE = "([^"]+)"/)?.[1];
  expect(cacheVersion).toMatch(/^fiscaliza-\d{14}$/);
  const localScripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(n => n.getAttribute('src')).filter(src => !/^https?:|^\/\//.test(src)));
  expect(localScripts.every(src => new URL(src, 'https://local.invalid/').searchParams.get('v') === cacheVersion)).toBe(true);
  await page.selectOption("#typeFilter", "Municipal");
  await page.selectOption("#budgetYearFilter", "2026");
  await expect(page.locator("#resultSummary")).toContainText("354 resultados");
  await page.goto("/emendas/#emenda=MUN-SAPL-2025-225");
  await expect(page.locator("#detailBody")).toContainText("Dudu Ottoni: R$ 5.000,00");
});

test("pacote inclui referência PNTP e abre os critérios de Varginha", async ({ page }) => {
  await page.goto("/index.html#auditometro");
  await expect(page.getByRole("heading", { name: "Auditômetro de Transparência", exact: true })).toHaveCount(1);
  await expect(page.locator(".transp-radar #pntpPanel")).toHaveCount(1);
  await expect(page.locator(".pntp-card__score")).toHaveCount(2);
  await expect(page.locator("#scorePrefeitura .pntp-card__score")).toHaveText("81,80%");
  await page.locator('[data-pntp-orgao="camara"][data-pntp-filtro="pendentes"]').click();
  await expect(page.locator("#pntpCriteria li")).toHaveCount(112);
  await page.getByRole("button", { name: "Fechar critérios" }).click();
  await page.locator("#auditometro").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "tmp/auditometro-azul-desktop.png" });
});

test("pacote abre Conformidade, carrega a fonte e instala cache offline", async ({ page, request }) => {
  const failures = [];
  page.on("response", response => { if (response.status() >= 400) failures.push(response.url()); });
  page.on("pageerror", error => failures.push(error.message));
  await page.goto("/conformidade.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toHaveAttribute("data-fiscaliza-ready", "true", { timeout: 30000 });
  await expect(page.locator("#matrizCoberturaDados tr")).not.toHaveCount(1);
  await expect(page.locator("#matrizCoberturaDados")).not.toContainText("Carregando");
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px "Inter"'))).toBe(true);
  const font = await request.get("/fonts/Inter-Variable.woff2");
  expect(font.ok()).toBe(true);
  const registered = await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
  expect(registered).toBe(true);
  expect(failures).toEqual([]);
});

test("pacote entrega folha e módulos sem depender da pasta de desenvolvimento", async ({ page }) => {
  await page.goto("/pessoal.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#listaPessoal article").first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#rankingPeriodoInfo")).not.toBeEmpty();
  expect(await page.evaluate(() => typeof window.FISCALIZA.pessoal.init)).toBe("function");
});
