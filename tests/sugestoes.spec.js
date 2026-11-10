const { test, expect } = require('@playwright/test');

for (const [device, width] of [['computador', 1366], ['celular', 390]]) {
  test(`convite de sugestão respeita o visitante no ${device}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.addInitScript(() => {
      const original = window.setTimeout.bind(window);
      window.setTimeout = (fn, delay, ...args) => original(fn, delay === 30000 ? 25 : delay, ...args);
    });
    await page.goto('/emendas/');
    await page.route('**/sugestao.php', async route => {
      const payload = route.request().postDataJSON();
      expect(payload.mensagem).toBe('O valor precisa ser conferido.');
      expect(payload.assunto).toBe('Possível erro nos dados');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    const panel = page.locator('[data-convite-sugestao]');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Escrever sugestão' }).click();
    const dialog = page.getByRole('dialog', { name: 'Envie sua sugestão' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Sobre o quê?').selectOption({ label: 'Possível erro nos dados' });
    await dialog.getByLabel('Sua sugestão').fill('O valor precisa ser conferido.');
    await dialog.getByLabel('Seu nome (opcional)').fill('Cidadão');
    await dialog.getByRole('button', { name: 'Enviar sugestão' }).click();
    await expect(dialog.getByRole('status')).toContainText('Sugestão aceita para envio');
    await dialog.getByRole('button', { name: 'Enviar outra sugestão' }).click();
    await page.unroute('**/sugestao.php');
    await page.route('**/sugestao.php', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false }) }));
    await dialog.getByLabel('Sobre o quê?').selectOption({ label: 'Possível erro nos dados' });
    await dialog.getByLabel('Sua sugestão').fill('O valor precisa ser conferido.');
    await dialog.getByRole('button', { name: 'Enviar sugestão' }).click();
    const mailto = await dialog.getByRole('link', { name: 'Abrir no aplicativo de e-mail' }).getAttribute('href');
    expect(mailto).toContain('contato@fiscalizavarginha.com.br');
    expect(decodeURIComponent(mailto)).toContain('O valor precisa ser conferido.');
    expect(decodeURIComponent(mailto)).toContain('Possível erro nos dados');
    const gmail = new URL(await dialog.getByRole('link', { name: 'Abrir no Gmail' }).getAttribute('href'));
    expect(gmail.origin).toBe('https://mail.google.com');
    expect(gmail.searchParams.get('to')).toBe('contato@fiscalizavarginha.com.br');
    expect(gmail.searchParams.get('body')).toContain('O valor precisa ser conferido.');
    expect(gmail.searchParams.get('su')).toContain('Possível erro nos dados');
    await expect(dialog.getByRole('status')).toContainText('Não foi possível enviar automaticamente');
    await dialog.getByLabel('Sua sugestão').fill('Texto alterado');
    await expect(dialog.getByRole('link', { name: 'Abrir no Gmail' })).toBeHidden();
    await dialog.getByRole('button', { name: 'Enviar sugestão' }).click();
    expect(new URL(await dialog.getByRole('link', { name: 'Abrir no Gmail' }).getAttribute('href')).searchParams.get('body')).toContain('Texto alterado');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    const rect = await panel.boundingBox();
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    await panel.getByRole('button', { name: 'Agora não' }).click();
    await expect(panel).toHaveCount(0);
    await page.reload();
    await expect(panel).toHaveCount(0);
    await page.getByRole('link', { name: 'Enviar sugestão', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Envie sua sugestão' })).toBeVisible();
  });
}
