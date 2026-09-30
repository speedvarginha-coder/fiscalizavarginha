const { test, expect } = require("@playwright/test");
test.use({ serviceWorkers: "block" });

test("cruzamento da Fundação usa cards legíveis no desktop e no celular", async ({ page }) => {
  // Layout usa dois fornecedores controlados; a coleta real pode não ter cruzamentos.
  const contratos = [
    { cnpj: "12.345.678/0001-90", contratado: "Fornecedor de teste Alfa", valor: 200 },
    { cnpj: "98.765.432/0001-10", contratado: "Fornecedor de teste Beta", valor: 100 },
  ];
  await page.route(/\/data\/chunks\/(fundacao_cultural|prefeitura_painel|camara_betha)\.json/, async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, contratos } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/fundacao.html");

  const bloco = page.locator("#fundacaoCruzamento");
  const grade = bloco.locator(".cross-supplier-grid");
  const cards = bloco.locator(".cross-supplier-card");
  await expect(cards.first()).toBeVisible({ timeout: 20_000 });
  await expect(cards).toHaveCount(2, { timeout: 20_000 });
  // O cruzamento é refeito quando os dois chunks de 2ª fase chegam. Aguarda
  // ambos para não capturar o bloco enquanto um card está sendo substituído.
  await page.waitForFunction(() => window.FISCALIZA_DATA?.prefeitura && window.FISCALIZA_DATA?.camara_betha);
  await expect.poll(
    () => grade.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length),
    { timeout: 10_000 },
  ).toBe(2);
  await bloco.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 104));
  await page.waitForTimeout(250);

  const desktop = await grade.evaluate((el) => {
    const [primeiro, segundo] = [...el.children].slice(0, 2).map((card) => card.getBoundingClientRect());
    const nome = el.children[0].querySelector(".cross-supplier-card__name").getBoundingClientRect();
    return { primeiro: { width: primeiro.width, y: primeiro.y }, segundo: { y: segundo.y }, nome: { width: nome.width } };
  });
  expect(desktop.primeiro.width).toBeGreaterThan(360);
  expect(Math.abs(desktop.primeiro.y - desktop.segundo.y)).toBeLessThan(4);
  expect(desktop.nome.width).toBeGreaterThan(250);
  await bloco.screenshot({ path: "test-results/fundacao-layout-section.png", animations: "disabled" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(cards.first()).toBeVisible({ timeout: 20_000 });
  await expect(cards).toHaveCount(2, { timeout: 20_000 });
  await bloco.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 84));
  await page.waitForTimeout(250);
  const mobile = await grade.evaluate((el) => {
    const [primeiro, segundo] = [...el.children].slice(0, 2).map((card) => card.getBoundingClientRect());
    return { primeiro: { width: primeiro.width, y: primeiro.y, height: primeiro.height }, segundo: { y: segundo.y } };
  });
  expect(mobile.primeiro.width).toBeGreaterThan(300);
  expect(mobile.segundo.y).toBeGreaterThan(mobile.primeiro.y + mobile.primeiro.height);
  await cards.first().screenshot({ path: "test-results/fundacao-layout-section-mobile.png", animations: "disabled" });
});
