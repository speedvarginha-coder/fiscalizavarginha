const {test,expect}=require('@playwright/test');
test.use({serviceWorkers:'block'});
const fs=require('node:fs');
const read=n=>JSON.parse(fs.readFileSync(`painel-cidadao/data/chunks/${n}.json`,'utf8'));

for (const orgao of ['prefeitura','camara']) {
 test(`${orgao}: histórico carrega sob demanda e encontra ficha fora do recorte principal`,async({page})=>{
  const historico=read(`contratos_historico_${orgao}`).contratos;
  const principal=read(orgao==='prefeitura'?'prefeitura':'camara_betha').contratos;
  const urls=new Set(principal.map(c=>c.fonte_url));
  const alvo=historico.find(c=>!urls.has(c.fonte_url)&&c.numero&&c.ano);
  expect(alvo).toBeTruthy();
  let requests=0;
  page.on('request',r=>{if(r.url().includes(`contratos_historico_${orgao}.json`))requests++;});
  await page.goto(orgao==='prefeitura'?'/prefeitura.html?tab=contratos':'/camara.html');
  await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
  expect(requests).toBe(0);
  const area=page.locator(`[data-contratos-historico="${orgao}"]`);
  await area.locator('summary').first().click();
  await expect(area.locator('[data-historico-contador]')).toHaveText(`${historico.length} ficha(s) encontrada(s)`);
  await area.getByRole('searchbox',{name:'Buscar no histórico'}).fill(`${alvo.numero}/${alvo.ano}`);
  const link=area.locator(`a[href="${alvo.fonte_url}"]`).first();
  await link.locator('..').locator('..').locator(':scope > summary').click();
  await expect(link).toBeVisible();
  await area.getByRole('searchbox',{name:'Buscar no histórico'}).fill('nenhum-resultadoteste-987654');
  await expect(area.locator('[data-historico-lista]')).toContainText('Isso não comprova inexistência');
  expect(requests).toBe(1);
 });
}

test('histórico indisponível preserva lista principal e permite nova tentativa',async({page})=>{
 let failed=true;
 await page.route('**/contratos_historico_camara.json',r=>failed?r.fulfill({status:503,body:'indisponivel'}):r.continue());
 await page.goto('/camara.html');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 const area=page.locator('[data-contratos-historico="camara"]');
 await area.locator('summary').first().click();
 await expect(area).toContainText('Histórico indisponível');
 await expect(page.locator('#contratosCamara .contrato').first()).toBeAttached();
 failed=false;
 await area.locator('summary').first().click();
 await area.locator('summary').first().click();
 await expect(area.locator('[data-historico-contador]')).toContainText('ficha(s) encontrada(s)');
});

test('histórico no celular encontra CNPJ sem pontuação e não transborda',async({page})=>{
 const alvo=read('contratos_historico_prefeitura').contratos.find(c=>String(c.cnpj||'').replace(/\D/g,'').length>=8);
 await page.setViewportSize({width:320,height:740});
 await page.goto('/prefeitura.html?tab=contratos');
 await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
 const area=page.locator('[data-contratos-historico="prefeitura"]');
 await area.locator('summary').first().click();
 await area.getByRole('searchbox',{name:'Buscar no histórico'}).fill(alvo.cnpj.replace(/\D/g,''));
 const link=area.locator(`a[href="${alvo.fonte_url}"]`).first();
 await link.locator('..').locator('..').locator(':scope > summary').click();
 await expect(link).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await area.screenshot({path:'tmp/historico-contratos-mobile.png'});
});
