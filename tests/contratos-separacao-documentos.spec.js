const { test, expect } = require('@playwright/test');

for (const width of [375, 1366]) {
  test(`separa indícios de contrato e aditivo sem declarar ausência (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const urls = [1, 2, 3].map(id => `https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/83043/detalhe/133849:9916:${id}_9916`);
    const base = {
      [urls[0]]: { status: 'disponivel', verificado_em: '2026-10-29', trilha: {empenhos:[{tipo:'Empenhar',numero:'183',ano:2024,data:'2024-01-02',valor:100,execucao:{status:'confirmado_na_fonte',fonte_url:'https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/82995/detalhe/133849:9916:15233002',valor_liquidado:70,valor_pago:50,liquidacoes:[{data:'2024-02-01',valor:70}],pagamentos:[{dataPagamento:'2024-02-02',valorPagamento:50}],documentos_fiscais:[{tipo:'Nota Fiscal',numero:'1',dataEmissao:'2024-01-30',valorDocumento:70}]}}],fiscal:'Fiscal Oficial'}, alteracoes_ficha: [{ tipo: 'Aditivo de prazo', numero: '1', ano: 2025 }], documentos: [
        { tipo: 'Termo de contratação', nome: 'ct121-2022.pdf', arquivo_id: 'c3b388ea-4787-4909-a7d0-7a7159666cb3', conferencia_pdf: { status: 'pdf_acessivel' } },
        { tipo: 'Termo de contratação', nome: 'ad212.pdf', arquivo_id: '../invalido' },
        { tipo: 'Termo de contratação', nome: 'arquivo-sem-tipo.pdf' }
      ] },
      [urls[1]]: { status: 'sem_documentos', alteracoes_ficha: [] },
      [urls[2]]: { status: 'nao_verificado', aditivos_qtd: 0 }
    };
    base[urls[0]].trilha.empenhos.push({tipo:'Empenhar',numero:'184',ano:2024,data:'2024-01-02',valor:100,execucao:{ultima_tentativa_status:'inconclusiva',motivo:'Não confirmado: data do empenho',fonte_consultada:'https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/82995/detalhe/133849:9916:15233003'}});
    await page.route('**/data/chunks/contratos_documentos.json', route => route.fulfill({ json: base }));
    await page.goto('/camara.html');
    await expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready', 'true', { timeout: 45000 });
    await page.evaluate(urls => FISCALIZA.dossie.abrirComHtml(urls.map(fonte_url => FISCALIZA.dossie.templateDocumentos({ fonte_url }, 'Prefeitura')).join('')), urls);
    const cards = page.locator('#modalFiscaliza .contrato-documentos');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText('Separação dos arquivos');
    const rows = cards.nth(0).locator('.contrato-documentos-resumo li');
    await expect(rows.nth(0)).toContainText('ct121-2022.pdf');
    await expect(rows.nth(0)).not.toContainText('ad212.pdf');
    await expect(rows.nth(1)).toContainText('ad212.pdf');
    await expect(rows.nth(2)).toContainText('arquivo-sem-tipo.pdf');
    await expect(cards.nth(0)).toContainText('1 registro(s) informado(s) pela Betha');
    await expect(cards.nth(0)).toContainText('2 registro(s) de empenho informado(s) na ficha');
    await expect(cards.nth(0)).toContainText('Não confirmado: data do empenho');
    await expect(cards.nth(0).getByRole('link',{name:'Conferir resultado consultado (vínculo não confirmado) ↗',includeHidden:true})).toHaveAttribute('href',/consulta\/82995\/detalhe/);
    await expect(cards.nth(0)).toContainText('Não é comprovante de liquidação, pagamento ou entrega');
    await expect(cards.nth(0)).toContainText('Fiscal Oficial');
    await expect(cards.nth(0)).toContainText('Pagamento informado: R$ 50,00');
    await expect(cards.nth(0).getByRole('link',{name:'abrir empenho oficial ↗',includeHidden:true})).toHaveAttribute('href',/consulta\/82995\/detalhe/);
    await expect(cards.nth(0)).toContainText('Nota Fiscal nº 1');
    const pdf = cards.nth(0).getByRole('link', { name: 'Abrir PDF na fonte ↗', includeHidden: true });
    await expect(pdf).toHaveAttribute('href', /documento-contrato\.php\?.*arquivo=c3b388ea-4787-4909-a7d0-7a7159666cb3/);
    await expect(cards.nth(0).getByRole('link', { name: 'Abrir arquivo na fonte ↗', includeHidden: true })).toHaveCount(0);
    await expect(cards.nth(1)).toContainText('0 registro(s) informado(s) pela Betha');
    await expect(cards.nth(2)).toContainText('Alterações na ficha: informação ainda não confirmada');
    const trail = await page.evaluate((info) => FISCALIZA.cidadao.trail({ numero: 121, ano: 2022 }, 'Prefeitura', info), base[urls[0]]);
    expect(trail).toContain('ct121-2022.pdf');
    expect(trail).toContain('ad212.pdf');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
