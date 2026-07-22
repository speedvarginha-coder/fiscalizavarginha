// @ts-check
const { test, expect } = require("@playwright/test");

test("pacote publico serve loader, chunk e modulo sem data.js", async ({ request }) => {
  const index = await request.get("/index.html");
  expect(index.ok()).toBeTruthy();
  const html = await index.text();
  expect(html).toContain('src="data-loader.js');
  expect(html).not.toMatch(/<script[^>]+src=["'][^"']*data\.js/i);

  for (const asset of [
    "/data-loader.js",
    "/data/chunks/resumo.json",
    "/modules/utils.js",
    "/modules/chat-cidadao.js",
  ]) {
    const response = await request.get(asset);
    expect(response.ok(), `${asset} deve responder via HTTP`).toBeTruthy();
    expect((await response.body()).length, `${asset} nao deve estar vazio`).toBeGreaterThan(0);
  }
});

test("conformidade publica origem, arquivo e canal de verificacao dos achados", async ({ page }) => {
  await page.goto("/conformidade.html", { waitUntil: "domcontentloaded" });
  const achados = page.locator("#iftAchados");
  await expect(achados).not.toContainText("Carregando os achados", { timeout: 10_000 });
  await expect(achados).toContainText("Fonte:");
  await expect(achados.locator("code").first()).toBeVisible();
  await expect(achados.locator('a[target="_blank"]').first()).toHaveAttribute("rel", "noopener");
  await expect(achados.locator(".ift-lai-btn").first()).toContainText("Copiar pedido de informação");
  await expect(achados).toContainText("Confiança:");
  await expect(achados).toContainText("Método:");
  await expect(achados).toContainText("Limitação:");
});

test("Prefeitura carrega a base pesada de diárias somente ao abrir a seção", async ({ page, request }) => {
  const requisicoesDiarias = [];
  page.on("request", (req) => {
    if (req.url().includes("/data/chunks/diarias.json")) requisicoesDiarias.push(req.url());
  });

  await page.goto("/prefeitura.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.ZELA_DATA_LOADER && window.ZELA_DATA);
  await page.waitForFunction(() => document.querySelector("#diariasPrefeituraBlock .progressive-data"), null, { timeout: 20_000 });

  expect(requisicoesDiarias).toHaveLength(0);
  expect(await page.evaluate(() => Boolean(window.ZELA_DATA.diarias))).toBe(false);
  await expect(page.locator("#diariasPrefeituraBlock .progressive-data")).toContainText("sob demanda");

  await page.locator('.pref-tab[data-pref-tab="diarias"]').click();
  await page.waitForFunction(() => Boolean(window.ZELA_DATA.diarias));
  await expect(page.locator("#listaDiariasPrefeitura .diaria-card").first()).toBeVisible();

  const fonte = await request.get("/data/chunks/diarias.json");
  const esperado = (await fonte.json()).prefeitura.length;
  const carregado = await page.evaluate(() => window.ZELA_DATA.diarias.prefeitura.length);
  expect(carregado).toBe(esperado);
  expect(requisicoesDiarias).toHaveLength(1);
  expect(await page.locator("body").getAttribute("data-chunk-diarias")).toBe("ready");
});

test("carregador progressivo reutiliza a mesma requisição e preserva todos os registros", async ({ page }) => {
  let requisicoes = 0;
  page.on("request", (req) => {
    if (req.url().includes("/data/chunks/diarias.json")) requisicoes += 1;
  });

  await page.goto("/camara.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.ZELA_DATA_LOADER && window.ZELA_DATA);
  const totais = await page.evaluate(async () => {
    const [a, b] = await Promise.all([
      window.ZELA_DATA_LOADER.load("diarias"),
      window.ZELA_DATA_LOADER.load("diarias"),
    ]);
    return [a.camara.length, b.camara.length, window.ZELA_DATA.diarias.camara.length];
  });

  expect(totais[0]).toBeGreaterThan(0);
  expect(totais[0]).toBe(totais[1]);
  expect(totais[1]).toBe(totais[2]);
  expect(requisicoes).toBe(1);
  const primeiroCard = page.locator("#listaDiariasCamara .diaria-card").first();
  await expect(primeiroCard).toHaveCount(1);
  expect(await page.locator("#listaDiariasCamara .diaria-card").count()).toBeGreaterThan(0);
  expect(await page.locator("#diariasCamaraBlock").getAttribute("data-progressive-state")).toBe("ready");
});
