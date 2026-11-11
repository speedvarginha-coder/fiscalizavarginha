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

test.describe('contrato que deixou de aparecer na fonte', () => {
  // O service worker responderia por conta própria e ignoraria a resposta simulada.
  test.use({ serviceWorkers: 'block' });
  test('cartão avisa desde quando o contrato não reaparece', async ({ page }) => {
    // A página da Prefeitura lê a projeção prefeitura_painel, que mantém todos os campos do contrato.
    await page.route('**/data/chunks/prefeitura_painel.json*', async route => {
      const resposta = await route.fetch();
      const dados = await resposta.json();
      dados.contratos.forEach(c => { c.ausente_na_fonte_desde = '2026-11-11'; });
      await route.fulfill({ response: resposta, json: dados });
    });
    await page.goto('/prefeitura.html?tab=contratos');
    await pronto(page);
    await expect(page.locator('#contratosBlock .contrato__sit', { hasText: 'não reapareceu na fonte desde 11/11/2026' }).first()).toBeVisible();
  });
});
