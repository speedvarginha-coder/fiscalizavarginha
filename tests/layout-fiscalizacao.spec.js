const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

for (const width of [390, 1366]) {
  test(`frota: filtros, origem e valores continuam acessíveis em ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/prefeitura.html?tab=frota');
    await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready', 'true', { timeout: 45000 });
    const area = page.locator('#frotaBlock');
    await page.getByRole('button', { name: 'Carregar veículos e despesas da frota' }).click();
    const grupo = area.getByRole('group', { name: 'Filtros da frota municipal' });
    await expect(grupo.getByLabel('Filtrar por tipo de aquisição')).toContainText('LOCADO', { timeout: 90000 });
    await grupo.getByLabel('Filtrar por tipo de aquisição').selectOption('LOCADO');
    const dados = await page.evaluate(() => ({
      frota: window.FISCALIZA_DATA.prefeitura.frota,
      frescor: window.FISCALIZA_DATA.prefeitura.coleta_frescor?.datasets?.frota,
    }));
    const locados = dados.frota.filter(v => v.tipo_aquisicao === 'LOCADO');
    await expect(area.locator('#frotaContador')).toContainText(locados.length.toLocaleString('pt-BR'));
    await expect(area.locator('.frota-card').first()).toBeVisible();
    await expect(area).toContainText('gastos vinculados');
    await expect(area.locator('.record-provenance').first()).toContainText('Betha');
    if (dados.frescor?.last_complete_at) {
      const [ano, mes, dia] = dados.frescor.last_complete_at.slice(0, 10).split('-');
      await expect(area.locator('#frotaCobertura')).toContainText(`${dia}/${mes}/${ano}`);
    }
    const busca = grupo.getByLabel('Buscar', { exact: true });
    await busca.focus();
    const situacao = grupo.getByLabel('Filtrar frota por situação');
    for (let i = 0; i < 4 && !(await situacao.evaluate(el => el === document.activeElement)); i++) {
      await page.keyboard.press('Tab');
    }
    await expect(situacao).toBeFocused();
    expect(await grupo.evaluate(el => getComputedStyle(el).display)).toBe('grid');
    expect(await grupo.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    if (width === 390) {
      await grupo.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('frota-mobile.png') });
    }
  });

  for (const [orgao, url, prefix] of [
    ['Prefeitura', '/prefeitura.html?tab=diarias', 'Prefeitura'],
    ['Câmara', '/camara.html#diarias', 'Camara'],
  ]) {
    test(`${orgao}: diárias mantêm os filtros e os avisos em ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 850 });
      await page.goto(url);
      await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready', 'true', { timeout: 45000 });
      const area = page.locator(`#diarias${prefix}Block`);
      const grupo = area.getByRole('group', { name: `Filtros de diárias da ${orgao}` });
      await expect(area.locator('.diaria-card').first()).toBeAttached({ timeout: 90000 });
      await expect(grupo.getByLabel('Filtrar diarias por ano')).toBeVisible();
      await expect(grupo.getByLabel('Filtrar diarias por mês')).toBeVisible();
      await expect(grupo.getByLabel('Buscar', { exact: true })).toBeVisible();
      await expect(area.locator('.diarias-coverage-note')).toContainText('Cobertura do recorte');
      await expect(area.locator('.record-provenance').first()).toContainText('Betha');
      await grupo.getByLabel('Buscar', { exact: true }).fill('termo-inexistente-987654321');
      await expect(area.locator(`#contadorDiarias${prefix}`)).toContainText('0');
      await grupo.getByLabel('Buscar', { exact: true }).fill('');
      await expect(area.locator('.diaria-card').first()).toBeAttached();
      expect(await grupo.evaluate(el => getComputedStyle(el).display)).toBe('grid');
      expect(await grupo.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
      if (width === 1366 && prefix === 'Prefeitura') {
        await grupo.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath('diarias-desktop.png') });
      }
    });
  }
}
