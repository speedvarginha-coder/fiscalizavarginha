const { test, expect } = require('@playwright/test');

const pronto = page => expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready', 'true', { timeout: 45000 });

test('numero de contrato zero vira "sem número publicado" e nunca "0/ano"', async ({ page }) => {
  await page.goto('/relatorios.html');
  await pronto(page);
  const rotulos = await page.evaluate(() => {
    const n = window.FISCALIZA.utils.numeroContrato;
    return [n({ numero: '0', ano: '2026' }), n({ numero: '', ano: '2025' }), n({ numero: '12', ano: '2026' }), n({ numero: 7 }), n({})];
  });
  expect(rotulos).toEqual(['sem número publicado (2026)', 'sem número publicado (2025)', '12/2026', '7', 'sem número publicado']);
  await expect(page.locator('body')).not.toContainText(/Contrato 0\/20\d\d/);
});

test('contratos e obras avisam a data da base quando ela foi preservada', async ({ page }) => {
  await page.goto('/prefeitura.html?tab=contratos');
  await pronto(page);
  const frescor = await page.evaluate(() => window.FISCALIZA_DATA.prefeitura.coleta_frescor?.datasets || {});
  for (const [conjunto, id] of [['contratos', '#contratosCobertura'], ['obras', '#obrasCobertura']]) {
    const meta = frescor[conjunto] || {};
    const preservada = /preserv|parcial|falha|mescla/.test(String(meta.status || '').toLowerCase());
    const aviso = page.locator(id);
    if (!preservada) { await expect(aviso).toBeHidden(); continue; }
    await expect(aviso).toContainText('base anterior foi mantida');
    const data = /^(\d{4})-(\d{2})-(\d{2})/.exec(meta.last_complete_at || '');
    await expect(aviso).toContainText(data ? `${data[3]}/${data[2]}/${data[1]}` : 'sem data registrada');
  }
});
