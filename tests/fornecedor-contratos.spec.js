const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

async function abrirCamara(page) {
  await page.goto('/camara.html');
  await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready', 'true', { timeout: 45000 });
}

test('Versao BR lista o contrato em execucao primeiro e mantem o encerrado visivel', async ({ page }) => {
  const url = 'https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324812/detalhe/133849:9918:1048_9918';
  await abrirCamara(page);
  await page.locator('#topFornecedoresCamara .forn-row').filter({ hasText: /VERS[ÃA]O BR/i }).locator("[data-forn-filtro]").click();
  const itens = page.locator('#modalFiscaliza article.report-note');
  await expect(itens).toHaveCount(2);
  await expect(itens.nth(0)).toContainText('Em execução');
  await expect(itens.nth(0).getByRole('link', { name: 'Abrir contrato na Betha' })).toHaveAttribute('href', url);
  await expect(itens.nth(1)).toContainText('Encerrado em 16/05/2020');
});

test('Unimed oferece escolha dos dois contratos sem abrir fornecedor diferente', async ({ page }) => {
  await abrirCamara(page);
  await page.locator('#topFornecedoresCamara .forn-row').filter({ hasText: /UNIMED/i }).locator("[data-forn-filtro]").click();
  const modal = page.locator('#modalFiscaliza');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('link', { name: 'Abrir contrato na Betha' })).toHaveCount(2);
  await expect(modal).toContainText('UNIMED');
  await expect(modal).not.toContainText('RONALDO');
  await page.screenshot({ path: 'tmp/fornecedor-escolher-contratos.png' });
});

test('fornecedor sem contrato nao mostra contratos de outras empresas', async ({ page }) => {
  await abrirCamara(page);
  await page.locator('#topFornecedoresCamara .forn-row').filter({ hasText: /INSS|INSTITUTO NACIONAL DO SEGURO SOCIAL/i }).locator("[data-forn-filtro]").click();
  await expect(page.locator('#contratosCamaraAviso')).toContainText('Nenhum contrato localizado');
  await expect(page.locator('#contratosCamara .contrato')).toHaveCount(0);
});

test('Prefeitura abre a ficha individual correspondente ao fornecedor', async ({page}) => {
 const base=JSON.parse(fs.readFileSync(path.join(__dirname,'../painel-cidadao/data/chunks/prefeitura.json'),'utf8'));
 const raiz=v=>String(v||'').replace(/\D/g,'').slice(0,8);
 const index=base.top_fornecedores_atual.slice(0,20).findIndex(f=>{
  const contratos=base.contratos.filter(c=>raiz(c.cnpj)===raiz(f.cnpj));
  return contratos.length===1 && Boolean(contratos[0].fonte_url);
 });
 expect(index).toBeGreaterThanOrEqual(0);
 const fornecedor=base.top_fornecedores_atual[index];
 const contrato=base.contratos.find(c=>raiz(c.cnpj)===raiz(fornecedor.cnpj));
 expect(contrato.fonte_url).toBeTruthy();
 await page.route('https://transparencia.betha.cloud/**',route=>route.fulfill({body:'<h1>Ficha oficial</h1>',contentType:'text/html'}));
 await page.goto('/prefeitura.html');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 await page.locator(`[data-pref-contratos="${index}"]`).click();
 await expect(page).toHaveURL(contrato.fonte_url);
});

test('Prefeitura oferece contratos do fornecedor e aviso para pagamento sem vinculo localizado', async ({page}) => {
 const base=JSON.parse(fs.readFileSync(path.join(__dirname,'../painel-cidadao/data/chunks/prefeitura.json'),'utf8'));
 const raiz=v=>String(v||'').replace(/\D/g,'').slice(0,8);
 const matches=f=>base.contratos.filter(c=>raiz(c.cnpj)===raiz(f.cnpj));
 const index=base.top_fornecedores_atual.slice(0,20).findIndex(f=>matches(f).length>1 && matches(f).every(c=>c.fonte_url));
 const sem=base.top_fornecedores_atual.slice(0,20).findIndex(f=>!matches(f).length);
 expect(index).toBeGreaterThanOrEqual(0);
 expect(sem).toBeGreaterThanOrEqual(0);
 await page.goto('/prefeitura.html');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 await page.locator(`[data-pref-contratos="${index}"]`).click();
 await expect(page.locator('#modalFiscaliza').getByRole('link',{name:'Abrir contrato na Betha'})).toHaveCount(matches(base.top_fornecedores_atual[index]).length);
 // Nova navegação permite exercitar o aviso sem depender do botão de fechamento.
 await page.goto('/prefeitura.html');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 await page.locator(`[data-pref-contratos="${sem}"]`).click();
 await expect(page.locator('#modalFiscaliza')).toContainText('Nenhum contrato localizado na base consultada');
 await expect(page.locator('#modalFiscaliza')).toContainText('Isso não confirma que o contrato não exista');
 await expect(page.locator('#modalFiscaliza').getByRole('link',{name:'Abrir contrato na Betha'})).toHaveCount(0);
});
