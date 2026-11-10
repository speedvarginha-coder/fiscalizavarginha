const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
test('ficha oficial Ronaldo', async({page})=>{
 await page.goto('/camara.html');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 const card=page.locator('#contratosCamara .contrato').filter({hasText:'RONALDO MENDES'});
 await expect(card).toBeVisible();
 await expect(card.locator('.contrato-documentos')).toContainText('Documento não localizado na ficha oficial em 06/10/2026');
 await expect(card.getByRole('link',{name:'Abrir ficha na Betha'})).toHaveAttribute('href','https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324812/detalhe/133849:9918:1159_9918');
 await card.scrollIntoViewIfNeeded();
 await page.screenshot({path:'tmp/contrato-ronaldo-ficha.png'});
 await card.getByRole('button',{name:'Resumo e como cobrar'}).click();
 await expect(page.getByRole('link',{name:'Abrir ficha deste contrato na Betha'})).toBeVisible();
});

test('documentos encontrados e disponibilidade inconclusiva sao distintos', async ({page}) => {
 await page.goto('/camara.html');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 const base=JSON.parse(fs.readFileSync(path.join(__dirname,'../painel-cidadao/data/chunks/contratos_documentos.json'),'utf8'));
 const urls=[Object.keys(base).find(url=>base[url].status==='disponivel'), Object.keys(base).find(url=>base[url].status==='nao_verificado')];
 await page.evaluate(urls=>{
   FISCALIZA.dossie.abrirComHtml(urls.map(fonte_url=>FISCALIZA.dossie.templateDocumentos({fonte_url},'Câmara')).join(''));
 },urls);
 const modal=page.locator('#modalFiscaliza');
 await expect(modal).toContainText('documento(s) localizado(s)');
 await expect(modal).toContainText('Disponibilidade dos documentos não confirmada');
 await expect(modal).not.toContainText('Documento não localizado na ficha oficial');
 await modal.locator('.contrato-documentos-acesso summary').first().click();
 await expect(modal).toContainText('Documentos relacionados');
 await page.screenshot({path:'tmp/contratos-documentos-observacoes.png'});
});

test('falha na consulta documental nao e apresentada como ausencia', async ({page}) => {
 await page.route('**/data/chunks/contratos_documentos.json',route=>route.fulfill({status:503,body:'indisponivel'}));
 await page.goto('/camara.html');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 const card=page.locator('#contratosCamara .contrato').filter({hasText:'RONALDO MENDES'});
 await expect(card.locator('.contrato-documentos')).toContainText('Documentos ainda não verificados');
 await expect(card.locator('.contrato-documentos')).not.toContainText('Documento não localizado');
});

test('avisos documentais cabem no celular sem rolagem horizontal', async ({page}) => {
 await page.setViewportSize({width:320,height:740});
 await page.goto('/camara.html');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 const card=page.locator('#contratosCamara .contrato').filter({hasText:'RONALDO MENDES'});
 await expect(card.locator('.contrato-documentos')).toContainText('Documento não localizado');
 await card.locator('.contrato-documentos-acesso summary').click();
 await card.scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 expect((await card.boundingBox()).width).toBeLessThanOrEqual(320);
 await card.screenshot({path:'tmp/contrato-documentos-mobile.png'});
});

test('ficha oficial Prefeitura no cartao e no dossie', async({page})=>{
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../painel-cidadao/data/chunks/prefeitura.json'),'utf8'));
 const contrato=data.contratos.find(c=>c.fonte_url);
 expect(contrato).toBeTruthy();
 await page.goto('/prefeitura.html?tab=contratos');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 await page.locator('#filtroAnoContrato').selectOption('');
 const link=page.locator('#contratos a').filter({hasText:'Abrir ficha na Betha'}).first();
 await expect(link).toHaveAttribute('href',contrato.fonte_url);
 const card=page.locator('#contratos .contrato').filter({has:page.locator(`a[href="${contrato.fonte_url}"]`)}).first();
 await card.scrollIntoViewIfNeeded();
 await page.screenshot({path:'tmp/contrato-prefeitura-ficha.png'});
 await card.getByRole('button',{name:'Resumo e como cobrar',exact:true}).click();
 await expect(page.getByRole('link',{name:'Abrir ficha deste contrato na Betha'})).toHaveAttribute('href',contrato.fonte_url);
});
