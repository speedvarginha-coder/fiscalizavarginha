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

test("pacote publica o Radar da Transparencia com os numeros da base oficial", async ({ page, request }) => {
  // O bloco voltou a ser o Radar, por decisao editorial: o painel do
  // Auditometro saiu da pagina inicial. O que este teste garante e o que
  // importa nos dois casos — o pacote publicado carrega a referencia oficial e
  // exibe indice e nivel iguais aos dela, sem chamar de validado o que a fonte
  // diz nao ser.
  const fonte = await (await request.get("/data/referencias/pntp-2025.json")).json();
  await page.goto("/index.html#radar-transparencia");
  const bloco = page.locator("#radar-transparencia");
  await expect(bloco).toHaveCount(1);
  await expect(bloco.locator(".transp-card")).toHaveCount(2);
  for (const [chave, rotulo] of [["prefeitura", "Prefeitura de Varginha"], ["camara", "Câmara de Varginha"]]) {
    const cartao = bloco.locator(".transp-card", { has: page.locator(`.transp-card__orgao:text-is("${rotulo}")`) });
    await expect(cartao.locator(".transp-card__indice")).toContainText(
      fonte.orgaos[chave].indice.toLocaleString("pt-BR", { maximumFractionDigits: 1 }),
    );
    await expect(cartao).toContainText(`Nível ${fonte.orgaos[chave].nivel}`);
  }
  await expect(bloco).toContainText("não constam como validados ou revisados");
  await bloco.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "tmp/radar-transparencia-desktop.png" });
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
