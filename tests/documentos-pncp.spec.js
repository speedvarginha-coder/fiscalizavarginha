const {test, expect} = require('@playwright/test');
test.use({serviceWorkers:'block'});
for (const width of [375, 1366]) {
  test(`fontes do PNCP são identificadas e URLs falsas são recusadas (${width}px)`, async ({page}) => {
    await page.setViewportSize({width, height:800});
    const url='https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324812/detalhe/133849:9918:1159_9918';
    await page.route('**/data/chunks/contratos_documentos.json', route => route.fulfill({json:{[url]:{
      status:'sem_documentos', verificado_em:'2026-10-29', pncp_ultima_tentativa_status:'inconclusiva', pncp_ultima_tentativa:'2026-10-29', alerta_data:{data_ficha:'12/01/2023',data_pdf:'12/01/2026',conferido_em:'2026-10-29'},
      fontes_adicionais:[
        {fonte:'PNCP',url:'https://pncp.gov.br/pncp-api/v1/orgaos/04366790000184/contratos/2026/4/arquivos/1',titulo:'Contrato 5/2026',vinculo:'confirmado_por_leitura'},
        {fonte:'Diário Oficial',url:'https://www.varginha.mg.gov.br/uploads/diario_123abc.pdf#page=26',titulo:'Extrato do aditivo',conferido_em:'2026-10-29'},
        {fonte:'PNCP',url:'https://pncp.gov.br.evil.example/arquivo',titulo:'Falso'}
      ]
    }}}));
    await page.goto('/camara.html');
    await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});
    await page.evaluate(url => FISCALIZA.dossie.abrirComHtml(FISCALIZA.dossie.templateDocumentos({fonte_url:url}, 'Câmara')),url);
    const card=page.locator('#modalFiscaliza .contrato-documentos');
    await expect(card).toContainText('Documento não localizado na ficha oficial');
    await expect(card).toContainText('Arquivos em outra fonte oficial');
    await expect(card).toContainText('Vínculo conferido no documento');
    await expect(card).toContainText('Última consulta ao PNCP inconclusiva');
    await expect(card).toContainText('Data de assinatura divergente entre fontes');
    await expect(card).toContainText('12/01/2023');
    await expect(card).toContainText('12/01/2026');
    await expect(card).toContainText('Extrato: não substitui o termo integral');
    await expect(card.getByRole('link',{name:'Contrato 5/2026 ↗',includeHidden:true})).toHaveCount(1);
    await expect(card.getByRole('link',{name:'Falso ↗',includeHidden:true})).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
