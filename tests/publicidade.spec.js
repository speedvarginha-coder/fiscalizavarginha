const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });
const fs = require('node:fs');
const path = require('node:path');

for (const width of [390, 1366]) {
  test(`publicidade separa órgãos, meses e cadastros em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/data/chunks/publicidade_*.json', route => {
      const camara = route.request().url().includes('publicidade_camara');
      return route.fulfill({ json: {
        status: camara ? 'partial' : 'ok',
        investimentos: [{ periodo: '2026-10', consultado_em: '2026-11-01T12:00:00Z',
          total_centavos: camara ? 20000 : 133457,
          meios: [{ meio: '<img src=x onerror=alert(1)> Rádio', valor_centavos: camara ? 20000 : 133457 }] },
          { periodo: '2026-09', consultado_em: '2026-10-01T12:00:00Z', total_centavos: 0, meios: [] }],
        cadastros: { fornecedores: { consultado_em: '2026-11-01T12:00:00Z', registros: [
          { nome: 'Fornecedor de teste', categoria: 'Produção', situacao: 'inativo', cnpj: '12.345.678/0001-90' }
        ] } }
      } });
    });
    await page.goto('/relatorios.html#publicidade');
    await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready', 'true', { timeout: 45000 });
    const section = page.locator('#publicidade');
    await expect(section.locator('tfoot')).toContainText('1.334,57', { timeout: 30000 });
    await expect(section).toContainText('Não comprovam pagamento');
    await expect(section.locator('img')).toHaveCount(0);
    await section.getByLabel('Órgão').selectOption('camara');
    await expect(section.locator('tfoot')).toContainText('200,00');
    await expect(section).toContainText('Coleta parcial');
    await expect(section).toContainText('01/11/2026');
    await section.getByLabel('Período da publicidade').selectOption('2026-09');
    await expect(section.locator('tfoot')).toContainText('0,00');
    await section.locator('summary').filter({ hasText: 'Fornecedores' }).click();
    await expect(section).toContainText('Fornecedor de teste');
    await expect(section).toContainText('inativo');
    await expect(section.getByRole('link', { name: 'Conferir investimentos na fonte' })).toHaveAttribute('href', /camara-municipal-de-varginha-mg/);
    expect(await section.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  });
}

test('publicidade informa falha de carregamento sem apresentar zero', async ({ page }) => {
  await page.route('**/data/chunks/publicidade_*.json', route => route.fulfill({ status: 503, body: 'indisponível' }));
  await page.goto('/relatorios.html#publicidade');
  await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready', 'true', { timeout: 45000 });
  await expect(page.locator('#publicidadeDados')).toContainText('ainda não estão disponíveis');
  await expect(page.locator('#publicidadeDados table')).toHaveCount(0);
});

test('publicidade apresenta os valores das duas bases reais coletadas', async ({ page }, testInfo) => {
  await page.goto('/relatorios.html#publicidade');
  await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready', 'true', { timeout: 45000 });
  const section = page.locator('#publicidade');
  for (const orgao of ['prefeitura', 'camara']) {
    const dados = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'painel-cidadao/data/chunks', `publicidade_${orgao}.json`), 'utf8'));
    await section.getByLabel('Órgão da publicidade', { exact: true }).selectOption(orgao);
    await expect(page.locator('#publicidadePeriodo option')).toHaveCount(dados.investimentos.length, { timeout: 30000 });
    const periodo = dados.investimentos[1] || dados.investimentos[0];
    await section.getByLabel('Período da publicidade').selectOption(periodo.periodo);
    const valor = (periodo.total_centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    await expect(page.locator('#publicidadeDados tfoot')).toContainText(valor);
  }
  await page.locator('#publicidade').screenshot({ path: testInfo.outputPath('publicidade-real.png') });
});
