const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

test('home no celular permite abrir comparações sem esconder navegação principal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  const fold = page.locator('details').filter({ has: page.locator('#homeMoneyMap') });
  await expect(fold).not.toHaveAttribute('open');
  await fold.locator('summary').click();
  await expect(fold).toHaveAttribute('open', '');
  await expect(page.locator('#homeMoneyMap')).toBeVisible();
  await expect(page.locator('#homeMoneyMap a').first()).toHaveText('Ver todos os contratos');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('details').filter({ has: page.locator('#homeTrendWatch') })).toHaveAttribute('open', '');
});

test('home não chama soma de contratos de valor pago quando pagamentos não foram informados', async ({ page }) => {
  await page.route('**/data/chunks/prefeitura_painel.json', async route => {
    const response = await route.fetch();
    const data = await response.json();
    delete data.total_externo_atual;
    await route.fulfill({ response, json: data });
  });
  await page.goto('/index.html');
  await expect(page.locator('#homeOpsStats .home-stat').first()).toContainText('Não informado');
});
