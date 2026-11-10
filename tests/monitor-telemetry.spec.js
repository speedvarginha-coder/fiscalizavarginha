const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'block' });

test('monitor usa falha recente independente do pacote e identifica telemetria vencida', async ({ page }) => {
  const old = { generated_at: '2026-01-01T00:00:00Z', sources: [], summary: { by_status: {} },
    last_completed_run: { coleta: 'SUCESSO', finished_at: '2026-01-01T00:00:00Z' } };
  let live = true;
  await page.route('**/data/chunks/monitoramento_coletas.json', route => route.fulfill({ json: old }));
  await page.route('**/operacao.json', route => live
    ? route.fulfill({ json: { schema_version: 1, generated_at: new Date().toISOString(),
      last_completed_run: { coleta: 'FALHA', finished_at: new Date().toISOString() } } })
    : route.fulfill({ status: 404, body: '' }));
  await page.goto('/monitoramento.html');
  await expect(page.locator('#summary')).toContainText('Falha');
  await expect(page.locator('#telemetryAge')).not.toContainText('Monitoramento defasado');
  live = false;
  await page.reload();
  await expect(page.locator('#telemetryAge')).toContainText('Monitoramento defasado');
  await expect(page.locator('#telemetryAge')).toContainText('não comprova o funcionamento atual');
});

test('fonte atual e verificação do release são distintas da telemetria anterior',async({page})=>{
 const old={generated_at:'2026-10-26T22:00:00Z',sources:[{id:'diarias',label:'Diárias antiga',status:'ok',source_updated_at:'2026-10-26T22:00:00Z',max_age_days:7}]};
 await page.route('**/data/chunks/monitoramento_coletas.json',r=>r.fulfill({json:old}));
 await page.route('**/data/chunks/status_fontes.json',r=>r.fulfill({json:{gerado_em:'2026-10-27T12:00:00Z',domains:{diarias:{label:'Diárias atual',status:'partial',source_updated_at:'2026-10-27T10:00:00Z',max_age_days:7,reason:'Detalhamento falhou'}}}}));
 await page.route('**/operacao.json',r=>r.fulfill({json:{schema_version:1,generated_at:'2026-10-27T13:00:00Z',last_verified_deployment:{status:'SUCESSO',checked_at:'2026-10-27T12:30:00Z',manifest_sha256:'antigo'}}}));
 await page.route('**/release.json',r=>r.fulfill({json:{manifest_sha256:'novo'}}));
 await page.goto('/monitoramento.html');
 await expect(page.locator('#sources')).toContainText('Diárias atual');await expect(page.locator('#sources')).toContainText('Parcial');
 await expect(page.locator('#telemetryAge')).toContainText('Cobertura das fontes gerada em');
 await expect(page.locator('#summary')).toContainText('Verificação anterior ao release atual');
});
