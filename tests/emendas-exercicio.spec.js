const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const ready=page=>expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});

test('trilha de emenda prepara cobrança com fonte e limitações',async({page})=>{
 await page.goto('/emendas/');
 await page.getByRole('button',{name:'Ver detalhes'}).first().click();
 const trail=page.getByRole('region',{name:'Do recurso à entrega',exact:true});await expect(trail).toContainText('Do recurso à entrega');
 await expect(trail).toContainText('não envia o pedido automaticamente');
 const link=trail.getByRole('link',{name:'Preparar pedido e acompanhar cobrança'});
 const href=await link.getAttribute('href');const params=new URL(href,'http://localhost').searchParams;
 expect(params.get('pedido')).toContain('empenhos');expect(params.get('pedido')).toContain('prestação de contas');
 expect(params.get('assunto')).toContain('Emenda');
});

test('dossiê não transforma pagamento ao beneficiário em percentual da emenda',async({page})=>{
 await page.goto('/camara.html');await ready(page);
 await page.evaluate(()=>FISCALIZA.dossie.abrirComHtml(FISCALIZA.dossie.templateEmenda({emenda:{numero:'5',ano:'2025',valor_brl:160000,beneficiario:'Entidade'},cruz:{status:'encontrado',exercicioOrcamentario:'2026',valor_pago_total:680}})));
 const modal=page.locator('#modalFiscaliza');await expect(modal).toContainText('680,00');await expect(modal).toContainText('exercício 2026');await expect(modal).toContainText('vínculo destes pagamentos');await expect(modal).not.toContainText('Relação com a emenda');
});
test('exercício desconhecido fica indisponível e ranking não afirma execução',async({page})=>{
 await page.goto('/camara.html');await ready(page);
 await expect(page.locator('#execucaoVereadorBlock')).toContainText('Correspondências por autoria');await expect(page.locator('#execucaoVereadorBlock')).not.toContainText('pago ÷ destinado');
 await page.evaluate(()=>FISCALIZA.dossie.abrirComHtml(FISCALIZA.dossie.templateEmenda({emenda:{numero:'317',ano:'2025',beneficiario:'Entidade'},cruz:{status:'sem_periodo',valor_pago_total:null}})));
 await expect(page.locator('#modalFiscaliza')).toContainText('Pagamento não verificado');await expect(page.locator('#modalFiscaliza')).toContainText('não significa valor zero');
});
test('conciliação indisponível não é apresentada como ausência de divergências',async({page})=>{
 await page.route('**/data/chunks/emendas_prefeitura.json*',r=>r.fulfill({status:503,body:'indisponível'}));await page.goto('/emendas/');
 await expect(page.locator('#reconciliacao')).toBeVisible();await expect(page.locator('#reconciliacao')).toContainText('Não foi possível carregar a conciliação');
});
test('perfil soma uma vez o pagamento ao mesmo beneficiário no mesmo exercício',async({page})=>{
 const root=path.join(__dirname,'../painel-cidadao/data/chunks');
 const pf=JSON.parse(fs.readFileSync(path.join(root,'prefeitura_painel.json'),'utf8'));
 const em=[1,2].map(numero=>({numero:String(numero),ano:'2025',autor:'Zilda Silva',beneficiario:'Entidade teste',cnpj:'25.863.390/0001-54',valor_brl:100,exercicioOrcamentario:'2026',objeto:'Objeto'}));
 pf.emendas_cruzadas=em.map(e=>({...e,status:'encontrado',valor_pago_total:680,pagamentos:[{ano:2026,valor:100}]}));
 await page.route('**/data/chunks/prefeitura_painel.json*',r=>r.fulfill({json:pf}));await page.route('**/data/chunks/emendas.json*',r=>r.fulfill({json:em}));
 await page.goto('/camara.html');await ready(page);
 await page.locator('.csec-btn[data-go="emendas"]').click();
 await page.locator('#filtroVereador').selectOption({label:'Zilda Silva'});
 const stats=page.locator('.ver-profile__stats');await expect(stats).toContainText('680,00');await expect(stats).not.toContainText('1.360,00');
 await page.locator('#filtroAnoPagamentosCnpj').selectOption('2026');
 const entity=await page.locator('#filtroEntidade option').evaluateAll(options=>options.find(o=>o.textContent.includes('Entidade teste'))?.value);
 expect(entity).toBeTruthy();await page.locator('#filtroEntidade').selectOption(entity);
 await expect(page.locator('#entidadeResumo')).toContainText(/pagamento localizado em 2026: R\$\s*680,00/);
 await page.locator('#filtroAnoPagamentosCnpj').selectOption('2025');
 await expect(page.locator('#entidadeResumo')).toContainText('ano selecionado fora do exercício coberto');
});

test('trilha da emenda aponta documentos a solicitar e não transforma ausência em zero',async({page})=>{
 await page.goto('/camara.html');await ready(page);
 await page.evaluate(()=>FISCALIZA.dossie.abrirComHtml(FISCALIZA.dossie.templateEmenda({emenda:{numero:'7',ano:'2025',beneficiario:'Entidade'},cruz:{status:'sem_periodo'}})));
 const box=page.locator('#modalFiscaliza');await expect(box).toContainText('Da indicação à entrega');await expect(box).toContainText('não foram confirmados automaticamente');await expect(box).toContainText('não prova que ele não exista');await expect(box).toContainText('não informado');
});

test('emendas apresenta tentativa financeira sem confundir base preservada',async({page})=>{
 await page.route('**/operacao.json',r=>r.fulfill({json:{financial_attempt:{concluido_em:'2026-10-27T12:00:00Z',ciclo:'parcial',fontes:{federal:'ok',tesouro:'preservado',estadual:'ok',reconciliacao:'preservado'}}}}));
 await page.goto('/emendas/');
 await expect(page.locator('#tentativasFinanceiras')).toContainText('Tesouro: base anterior preservada');
 await expect(page.locator('#tentativasFinanceiras')).toContainText('Reconciliação municipal: base anterior preservada');
 await expect(page.locator('#tentativasFinanceiras')).toContainText('mantêm suas datas anteriores');
});

test('busca sem correspondência não é anunciada como pagamento localizado',async({page})=>{
 await page.goto('/camara.html');await ready(page);
 await page.evaluate(()=>FISCALIZA.dossie.abrirComHtml(FISCALIZA.dossie.templateEmenda({emenda:{numero:'9',ano:'2025',beneficiario:'Entidade'},cruz:{status:'sem_pagamento',exercicioOrcamentario:'2026'}})));
 const box=page.locator('#modalFiscaliza');await expect(box).toContainText('Busca de pagamentos ao beneficiário');await expect(box).toContainText('no exercício 2026');await expect(box).toContainText('não comprova ausência de execução');await expect(box).toContainText('não comprova que o contrato esteja vinculado');
});
