const { test, expect } = require('@playwright/test');

for (const [name, width] of [['computador', 1366], ['celular', 390]]) test(`fontes ficam acessíveis no ${name}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 });
  await page.goto('/emendas/');
  const link = page.getByRole('link', { name: 'Ver todas as fontes e suas limitações' });
  await expect(link).toHaveAttribute('href', '../sobre.html#fontes-dados');
  await link.click();
  await expect(page).toHaveURL(/sobre\.html#fontes-dados/);
  const section = page.locator('#fontes-dados');
  await expect(section.getByRole('heading', { name: 'De onde vêm os dados' })).toBeVisible();
  await expect(section).toContainText('Documentos de despesa');
  await expect(section).toContainText('serviços de terceiros');
  await expect(section).toContainText('não significam que todos os seus dados estejam integrados');
  await expect(section.getByRole('link', { name: 'Documentos de despesa' })).toHaveAttribute('href', /portaldatransparencia\.gov\.br/);
});
