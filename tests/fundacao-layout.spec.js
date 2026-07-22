const { test, expect } = require("@playwright/test");

test("cruzamento da Fundação usa cards legíveis no desktop e no celular", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://127.0.0.1:4173/fundacao.html");

  const bloco = page.locator("#fundacaoCruzamento");
  const grade = bloco.locator(".cross-supplier-grid");
  const cards = bloco.locator(".cross-supplier-card");
  await expect(cards.first()).toBeVisible({ timeout: 20_000 });
  await expect(cards).toHaveCount(12, { timeout: 20_000 });
  // O cruzamento é refeito quando os dois chunks de 2ª fase chegam. Aguarda
  // ambos para não capturar o bloco enquanto um card está sendo substituído.
  await page.waitForFunction(() => window.ZELA_DATA?.prefeitura && window.ZELA_DATA?.camara_betha);
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
  await expect(cards).toHaveCount(12, { timeout: 20_000 });
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
