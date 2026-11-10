const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const ready=page=>expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});

test('modelos LAI aplicam período escolhido, bloqueiam intervalo inválido e copiam o texto visível',async({page})=>{
 await page.goto('/cobrar.html');await ready(page);
 const card=page.locator('.template-card').filter({has:page.getByRole('heading',{name:'LAI 1 · Câmara: Frequência de vereadores',exact:true})});
 await page.locator('#laiPeriodoInicio').fill('2025-02-01');await page.locator('#laiPeriodoFim').fill('2026-03-31');
 await expect(card.locator('textarea')).toHaveValue(/01\/02\/2025 a 31\/03\/2026/);
 await expect(card.locator('textarea')).not.toHaveValue(/Cópias dos atestados médicos/);
 await expect(card.locator('textarea')).toHaveValue(/ocultação de diagnósticos/);
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:t=>{window.copiado=t;return Promise.resolve();}},configurable:true}));
 await card.locator('.copy-template').click();expect(await page.evaluate(()=>window.copiado)).toEqual(await card.locator('textarea').inputValue());
 await page.locator('#laiPeriodoInicio').fill('2027-01-01');await expect(card.locator('.copy-template')).toBeDisabled();
 await expect(page.locator('#laiPeriodoStatus')).toContainText('inicial deve ser anterior');
 await page.locator('#laiPeriodoInicio').fill('2024-01-01');await expect(card.locator('.copy-template')).toBeEnabled();
 await expect(page.locator('#lai2026Textarea')).toHaveValue(/2026/);
 await expect(page.locator('#lai2026Textarea')).not.toHaveValue(/01\/01\/2024/);
});

test('data da consulta canônica chega pela projeção ao dossiê',async({page})=>{
 const {prefeituraPainel}=await import('../scripts/lib/dados-painel.mjs');
 const base=JSON.parse(fs.readFileSync(path.join(__dirname,'../painel-cidadao/data/chunks/prefeitura.json'),'utf8'));
 base.emendas_cruzamento_meta={consultado_em:'2026-10-21T12:00:00Z',metodo:'raiz_cnpj_e_exercicio_documental'};
 await page.route('**/data/chunks/prefeitura_painel.json*',r=>r.fulfill({json:prefeituraPainel(base)}));
 await page.goto('/camara.html');await ready(page);
 await page.evaluate(()=>FISCALIZA.dossie.abrirComHtml(FISCALIZA.dossie.templateEmenda({emenda:{numero:'5',ano:'2025',beneficiario:'Teste'},cruz:{status:'encontrado',exercicioOrcamentario:'2026',valor_pago_total:680}})));
 await expect(page.locator('#modalFiscaliza')).toContainText('21/10/2026');
 await expect(page.locator('#modalFiscaliza')).not.toContainText('data não informada');
});

test('tabelas de emendas permitem foco por teclado e indicação tem estrutura válida',async({page})=>{
 await page.goto('/emendas/');
 const treasury=page.locator('.treasury-table-wrap');await treasury.focus();await expect(treasury).toBeFocused();
 await expect(page.locator('.reconc-tabela-wrap').first()).toBeVisible({timeout:30000});
 await page.locator('.reconc-tabela-wrap').first().focus();await expect(page.locator('.reconc-tabela-wrap').first()).toBeFocused();
 await expect(page.locator('.results-header dt,.results-header dd')).toHaveCount(0);
});

test('cobertura prepara uma pergunta sobre a lacuna e preserva o órgão',async({page})=>{
 await page.goto('/prefeitura.html');await ready(page);
 const coverage=page.locator('[data-coverage-content]');await coverage.locator('summary').click();
 const source=coverage.locator('article').filter({has:page.getByRole('heading',{name:'Prefeitura/Betha',exact:true})});
 await source.getByRole('link',{name:'Acompanhar esta cobrança'}).click();await ready(page);
 await expect(page.locator('[data-tracking-form] [name=orgao]')).toHaveValue('Prefeitura');
 await expect(page.locator('[data-tracking-form] [name=pedido]')).toHaveValue(/fichas oficiais dos contratos/);
 await expect(page.locator('[data-tracking-form] [name=pedido]')).toHaveValue(/INFORMAR INÍCIO E FIM/);
});
