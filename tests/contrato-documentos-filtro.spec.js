const {test,expect}=require('@playwright/test');
test.use({serviceWorkers:'block'});
const fs=require('node:fs');
const path=require('node:path');
const base=JSON.parse(fs.readFileSync(path.join(__dirname,'../painel-cidadao/data/chunks/contratos_documentos.json'),'utf8'));
const tem=c=>base[c.fonte_url]?.status==='disponivel' && base[c.fonte_url].documentos?.length>0;

test('Prefeitura filtra os arquivos identificados e combina busca e ano',async({page})=>{
 const pref=JSON.parse(fs.readFileSync(path.join(__dirname,'../painel-cidadao/data/chunks/prefeitura.json'),'utf8'));
 const esperado=pref.contratos.filter(tem).length;
 await page.goto('/prefeitura.html?tab=contratos');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 const filtro=page.getByRole('combobox',{name:'Filtrar por disponibilidade de documentos'});
 await expect(filtro).toBeEnabled();
 await page.locator('#filtroAnoContrato').selectOption('');
 await filtro.selectOption('com');
 await expect(page.locator('#contratosContador')).toContainText(`${esperado} contratos`);
 const cards=page.locator('#contratos .contrato');
 await expect(cards).toHaveCount(Math.min(20,esperado));
 for(const texto of await cards.locator('[data-documentos-selo]').allTextContents()) expect(texto).toMatch(/\d+ arquivo\(s\) identificado\(s\).*conferido em \d{2}\/\d{2}\/\d{4}/);
 await page.locator('#filtroContrato').fill('VIACAO REAL');
 await expect(cards).toHaveCount(1);
 await expect(cards).toContainText('121/2022');
 await cards.first().screenshot({path:'tmp/filtro-documentos-prefeitura.png'});
 await page.locator('#filtroContrato').fill('SEM RESULTADO 987654321');
 await expect(page.locator('#contratos')).toContainText('Nenhum contrato encontrado');
 await page.getByRole('button',{name:'Limpar filtros',exact:true}).click();
 await expect(filtro).toHaveValue('');
 await expect(page.locator('#contratosContador')).toContainText(`${pref.contratos.length} contratos`);
});

test('Camara filtra somente contratos da lista com documentos identificados',async({page})=>{
 const cam=JSON.parse(fs.readFileSync(path.join(__dirname,'../painel-cidadao/data/chunks/camara_betha.json'),'utf8'));
 await page.goto('/camara.html');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 const filtro=page.getByRole('combobox',{name:'Filtrar por disponibilidade de documentos'});
 await expect(filtro).toBeEnabled();
 await filtro.selectOption('com');
 await expect(page.locator('#contratosContadorCamara')).toHaveText(`${cam.contratos.filter(tem).length} contratos`);
 await page.locator('#filtroContratoCamara').fill('RONALDO');
 await expect(page.locator('#contratosCamara .contrato')).toHaveCount(0);
 await expect(page.locator('#contratosCamara')).toContainText('disponibilidade não confirmada não significa ausência');
 await filtro.selectOption('');
 await expect(page.locator('#contratosCamara .contrato')).toHaveCount(1);
});

test('falha no catalogo desativa filtro sem esconder contratos',async({page})=>{
 await page.route('**/data/chunks/contratos_documentos.json',r=>r.fulfill({status:503,body:'indisponivel'}));
 await page.goto('/prefeitura.html?tab=contratos');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 await expect(page.getByRole('combobox',{name:'Filtrar por disponibilidade de documentos'})).toBeDisabled();
 await expect(page.locator('#documentosFiltroAjuda')).toContainText('Catálogo documental indisponível');
 await expect(page.locator('#contratos .contrato')).toHaveCount(20);
 await expect(page.locator('#contratos [data-documentos-selo]').first()).toContainText('Disponibilidade não confirmada');
});

test('filtro e quantidade de arquivos cabem na tela de 320px',async({page})=>{
 await page.setViewportSize({width:320,height:740});
 await page.goto('/camara.html');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 await page.getByRole('button',{name:'Filtrar e buscar contratos',exact:true}).click();
 const filtro=page.getByRole('combobox',{name:'Filtrar por disponibilidade de documentos'});
 await expect(filtro).toBeEnabled();
 await filtro.selectOption('com');
 await page.getByRole('button',{name:'Aplicar filtros',exact:true}).click();
 await expect(filtro).not.toBeVisible();
 await expect(page.locator('#contratosCamara [data-documentos-selo]').first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

test('Prefeitura permite aplicar filtro documental no celular',async({page})=>{
 await page.setViewportSize({width:320,height:740});
 await page.goto('/prefeitura.html?tab=contratos');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 await page.getByRole('button',{name:'🔍 Filtrar e Buscar Contratos',exact:true}).click();
 const filtro=page.getByRole('combobox',{name:'Filtrar por disponibilidade de documentos'});
 await expect(filtro).toBeEnabled();
 await filtro.selectOption('com');
 await page.getByRole('button',{name:'Aplicar Filtros',exact:true}).click();
 await expect(filtro).not.toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await expect(page.locator('#contratos [data-documentos-selo]').first()).toContainText('arquivo(s) identificado(s)');
});
