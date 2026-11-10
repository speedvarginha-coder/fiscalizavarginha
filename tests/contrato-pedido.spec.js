const {test,expect}=require('@playwright/test');
test('pedido identifica contrato, orgao e ficha e oferece copia manual se clipboard falhar',async({page})=>{
 await page.goto('/camara.html');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 const card=page.locator('#contratosCamara .contrato').filter({hasText:'RONALDO MENDES'});
 await card.locator('.contrato-documentos-pedido summary').click();
 const text=card.getByRole('textbox',{name:'Pedido de cópia do contrato'});
 await expect(text).toHaveValue(/À Câmara de Varginha.*contrato 5\/2026.*RONALDO MENDES.*1159_9918/);
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('sem permissão'))},configurable:true}));
 await card.getByRole('button',{name:'Copiar pedido',exact:true}).click();
 await expect(card.getByRole('status')).toContainText('manualmente');
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:t=>{window.pedidoCopiado=t;return Promise.resolve();}},configurable:true}));
 await card.getByRole('button',{name:'Copiar pedido',exact:true}).click();
 await expect(card.getByRole('status')).toContainText('Pedido copiado');
 expect(await page.evaluate(()=>window.pedidoCopiado)).toContain('todos os aditivos');
});
test('divergencia documentada aparece sem modificar valores do painel',async({page})=>{
 await page.goto('/prefeitura.html?tab=contratos');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 await page.evaluate(()=>FISCALIZA.dossie.abrirComHtml(FISCALIZA.dossie.templateDocumentos({numero:65,ano:2025,contratado:'MR SOLUCOES',fonte_url:'https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83043/detalhe/133849:9916:8716_9916'},'Prefeitura')));
 await expect(page.locator('#modalFiscaliza')).toContainText('Diferença identificada entre painel e ficha oficial');
 await expect(page.locator('#modalFiscaliza')).toContainText('98.125,16');
 await expect(page.locator('#modalFiscaliza')).toContainText('148.746,80');
});

test('pedido permanece aberto quando catálogo documental termina de carregar',async({page})=>{
 let liberar;const espera=new Promise(resolve=>{liberar=resolve});
 await page.route('**/data/chunks/contratos_documentos.json*',async route=>{await espera;await route.continue()});
 await page.goto('/camara.html');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 const card=page.locator('#contratosCamara .contrato').filter({hasText:'RONALDO MENDES'});
 const details=card.locator('.contrato-documentos-pedido');await details.locator('summary').click();
 await expect(details).toHaveAttribute('open','');
 liberar();
 await expect(page.locator('#filtroDocumentosContratoCamara')).toBeEnabled({timeout:30000});
 await expect(details).toHaveAttribute('open','');
 await expect(details.getByRole('textbox',{name:'Pedido de cópia do contrato'})).toBeVisible();
});
