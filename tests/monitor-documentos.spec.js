const {test,expect}=require('@playwright/test');
for (const width of [375,1366]) {
 test(`monitor informa cobertura e limites documentais em ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:800});
  await page.route('**/data/chunks/cobertura_documental.json',route=>route.fulfill({json:{gerado_em:'2026-10-29T12:00:00Z',pncp:{ano:2026,registros:87,correspondencias_candidatas:81,sem_correspondencia_automatica:6,fichas_com_arquivos:56,anos_anteriores:[{ano:'2025',registros:20,status:'ok'}],ultima_rodada:{status:'parcial',inconclusivas:2}},diario:{fichas_com_extratos:1},amostras:{executado_em:'2026-10-28T12:00:00Z',conjuntos:{contratos:{status:'parcial',registros:3,divergencias:1,detalhes_divergencias:[{ficha:'https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83043/detalhe/133849:9916:7444_9916',numero:'166',ano:'2023',valor_painel_na_amostra:50,valor_fonte_na_amostra:70,situacao:'corrigido_apos_amostra',corrigido_em:'2026-10-29T12:00:00Z'}]}}}}}));
  await page.goto('/monitoramento.html');
  const content=page.locator('#document-monitor');
  await expect(content).toContainText('81 associações candidatas');
  await expect(content).toContainText('6 sem correspondência automática');
  await expect(content).toContainText('2 inconclusivas');
  await expect(content).toContainText('não certificam toda a base');
  await expect(content).toContainText('2025: 20 registros');
  await expect(content).toContainText('Corrigido após a amostra');
  await expect(content.getByRole('link',{name:'Contrato 166/2023 ↗'})).toHaveAttribute('href',/transparencia\.betha\.cloud/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}
