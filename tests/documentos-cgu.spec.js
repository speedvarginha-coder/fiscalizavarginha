const { test, expect } = require('@playwright/test');

test('detalhe federal mostra documentos da CGU e suas limitações', async ({ page }) => {
  await page.route('**/emendas/data/documentos_cgu.json*', route => route.fulfill({ json: {
    coletadoEm: '2026-10-28T12:00:00Z', fontes: [{ ano: 2026 }], documentos: [{
      emenda: '202639760006', cnpj: '19315153000141', fase: 'Pagamento', documento: 'OB-AMOSTRA',
      data: '08/05/2026', pago: '1500000,00', anoArquivo: 2026
    }]
  }}));
  await page.goto('/emendas/');
  await page.evaluate(() => {
    const record = allRecords.find(r => r.emenda === '202639760006');
    if (!record) throw new Error('amostra não localizada');
    record.documentoBeneficiario = '19315153000141';
    openDetails(record.id);
  });
  const section = page.locator('[aria-label="Documentos federais da CGU"]');
  await expect(section).toContainText('OB-AMOSTRA');
  await expect(section).toContainText('não comprovam crédito em conta');
  await expect(section).toContainText('não necessariamente o mês');
});
