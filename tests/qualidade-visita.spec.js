const { test, expect } = require('@playwright/test');
const ready = page => expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready', 'true', { timeout: 45000 });

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`registro contábil e fonte para cobrança — ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/prefeitura.html?tab=diarias'); await ready(page);
    await expect(page.locator('.diarias-resumo').first()).toContainText('não comprovam, sozinhos, pagamento');
    await page.getByRole('button', { name: 'Fiscalizar esta diária' }).first().click();
    const modal = page.locator('#modalFiscaliza');
    await expect(modal).toContainText('O que consta no registro');
    const source = await modal.getByRole('link', { name: 'Abrir fonte oficial' }).getAttribute('href');
    await modal.getByRole('link', { name: 'Acompanhar esta cobrança' }).click(); await ready(page);
    await expect(page.getByLabel('Link da fonte')).toHaveValue(source);
    await expect(page.getByLabel('Etapa da cobrança')).toHaveValue('rascunho');
  });
  test(`dossiê de fornecedor descreve limites da vigência — ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport); await page.goto('/camara.html'); await ready(page);
    await page.getByRole('button', { name: 'Dossiê', exact: true }).first().click();
    const modal = page.locator('#modalFiscaliza');
    await expect(modal).toContainText('Contratos relacionados encontrados');
    await expect(modal).toContainText('pode incluir contratos históricos');
    await expect(modal).not.toContainText('Contratos vigentes relacionados');
  });
}
test('anexo de nome abreviado é pista, sem afirmar que seu conteúdo é aditivo', async ({ page }) => {
  await page.goto('/prefeitura.html'); await ready(page);
  const html = await page.evaluate(() => FISCALIZA.cidadao.trail({ numero: '121', ano: '2022' }, 'Prefeitura', {
    status: 'disponivel', documentos: [{ tipo: 'Documento', nome: 'ad212-viacao real.pdf' }]
  }));
  expect(html).toMatch(/Aditivos<\/strong>: o catálogo lista 1 arquivo/);
  expect(html).toContain('Nomes de arquivos são pistas');
});
test('cobertura do executado distingue zero informado e ausência; menu móvel usa teclado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/emendas/');
  const menu = page.getByRole('button', { name: 'Abrir menu' }); await menu.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Fechar menu' })).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape'); await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#metricExecutedCoverage')).toContainText(/\d+ de \d+ registros com valor informado/);
  await expect(page.locator('#metricExecutedCoverage')).toContainText('não comprova execução zero');
});
