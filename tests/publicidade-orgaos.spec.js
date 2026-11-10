const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

for (const [orgao, url] of [['prefeitura', '/prefeitura.html'], ['camara', '/camara.html']]) {
  for (const width of [390, 1366]) {
    test(`${orgao}: aba de publicidade mostra a base própria em ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      const requested = [];
      await page.route('**/data/chunks/publicidade_*.json', route => {
        requested.push(route.request().url());
        const name = route.request().url().includes('publicidade_camara') ? 'camara' : 'prefeitura';
        return route.fulfill({ json: {
          status: 'ok', investimentos: [{ periodo: '2026-10', consultado_em: '2026-11-05T12:00:00Z',
            total_centavos: name === 'camara' ? 20000 : 10000,
            meios: [{ meio: name === 'camara' ? 'Rádio' : 'Internet', valor_centavos: name === 'camara' ? 20000 : 10000 }] }],
          cadastros: { fornecedores: { consultado_em: '2026-11-05T12:00:00Z', registros: [{ nome: 'Fornecedor de teste', categoria: 'Produção', situacao: 'ativo' }] } }
        } });
      });
      await page.goto(url);
      await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready', 'true', { timeout: 45000 });
      const botao = orgao === 'prefeitura' ? page.getByRole('tab', { name: 'Publicidade' }) : page.getByRole('button', { name: 'Publicidade', exact: true });
      await botao.click();
      const painel = orgao === 'prefeitura' ? page.locator('#panel-publicidade') : page.locator('[data-csec="publicidade"]');
      await expect(painel).toBeVisible();
      await expect(painel.locator('tfoot')).toContainText(orgao === 'camara' ? '200,00' : '100,00', { timeout: 30000 });
      await expect(painel).toContainText('Não comprovam pagamento');
      await expect(painel.getByRole('link', { name: 'Conferir investimentos na fonte' })).toHaveAttribute('href', orgao === 'camara' ? /camara-municipal-de-varginha-mg/ : /municipio-de-varginha/);
      await expect(painel.locator('summary').filter({ hasText: 'Fornecedores' })).toBeVisible();
      expect(requested.every(url => url.includes(`publicidade_${orgao}.json`))).toBeTruthy();
      expect(await painel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
      await page.reload();
      await expect(painel).toBeVisible();
    });
  }
}

test('fonte de publicidade indisponível não aparece como valor zero', async ({ page }) => {
  await page.route('**/data/chunks/publicidade_prefeitura.json', route => route.fulfill({ status: 503, body: 'indisponível' }));
  await page.goto('/prefeitura.html#publicidade');
  await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready', 'true', { timeout: 45000 });
  await expect(page.locator('#publicidadeDados')).toContainText('ainda não estão disponíveis', { timeout: 30000 });
  await expect(page.locator('#publicidadeDados table')).toHaveCount(0);
});

for (const [orgao, url] of [['prefeitura', '/prefeitura.html#publicidade'], ['camara', '/camara.html#publicidade']]) {
  test(`${orgao}: acumulado soma apenas meses disponíveis do ano selecionado`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 850 });
    await page.route(`**/data/chunks/publicidade_${orgao}.json`, route => route.fulfill({ json: {
      status: 'partial', investimentos: [
        { periodo: '2025-03', total_centavos: 15000, consultado_em: '2026-11-05T12:00:00Z', meios: [{ meio: 'Rádio', valor_centavos: 15000 }] },
        { periodo: '2025-01', total_centavos: 10000, consultado_em: '2026-11-05T12:00:00Z', meios: [{ meio: 'Internet', valor_centavos: 10000 }] },
        { periodo: '2024-12', total_centavos: 90000, consultado_em: '2026-11-05T12:00:00Z', meios: [{ meio: 'Jornal', valor_centavos: 90000 }] },
      ], cadastros: {}
    } }));
    await page.goto(url);
    await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready', 'true', { timeout: 45000 });
    const painel = orgao === 'prefeitura' ? page.locator('#panel-publicidade') : page.locator('[data-csec="publicidade"]');
    const acumulado = painel.locator('[data-publicidade-acumulado]');
    await expect(acumulado).toContainText('250,00', { timeout: 30000 });
    await expect(acumulado).toContainText('2 de 12 meses');
    await expect(painel.locator('tfoot')).toContainText('150,00');
    await expect(painel).toContainText('Sem dados confirmados para fev');
    await expect(painel).toContainText('esses meses não foram tratados como zero');
    await expect(painel).toContainText('Coleta parcial');
    await painel.getByLabel('Período da publicidade').selectOption('2024-12');
    await expect(acumulado).toContainText('900,00');
    await expect(acumulado).toContainText('1 de 12 meses');
    expect(await painel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    if (orgao === 'prefeitura') await painel.screenshot({ path: testInfo.outputPath('acumulado-mobile.png') });
  });
}

test('acumulado do ano corrente não soma meses futuros', async ({ page }) => {
  const hoje = new Date(), ano = hoje.getFullYear(), mes = hoje.getMonth() + 1;
  const periodo = m => `${ano}-${String(m).padStart(2, '0')}`;
  const entrada = (p, v) => ({ periodo: p, total_centavos: v, consultado_em: '2026-11-05T12:00:00Z', meios: [{ meio: 'Rádio', valor_centavos: v }] });
  const itens = [entrada(periodo(mes), 10000)];
  if (mes < 12) itens.push(entrada(periodo(mes + 1), 50000));
  itens.push(entrada(`${ano + 1}-01`, 70000));
  await page.route('**/data/chunks/publicidade_prefeitura.json', route => route.fulfill({ json: { status: 'ok', investimentos: itens, cadastros: {} } }));
  await page.goto('/prefeitura.html#publicidade');
  await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready', 'true', { timeout: 45000 });
  const acumulado = page.locator('[data-publicidade-acumulado]');
  await expect(acumulado).toContainText('100,00', { timeout: 30000 });
  await expect(acumulado).not.toContainText('600,00');
  await page.getByLabel('Período da publicidade').selectOption(`${ano + 1}-01`);
  await expect(acumulado).toContainText('Não disponível');
  await expect(acumulado).toContainText('Ano ainda não iniciado');
});
