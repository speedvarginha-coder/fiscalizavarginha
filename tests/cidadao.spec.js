const {test,expect}=require('@playwright/test');
// O service worker responde por conta própria e ignora page.route; com ele ativo
// as respostas simuladas abaixo só valiam quando o teste ganhava a corrida.
test.use({serviceWorkers:'block'});
const ready=page=>expect(page.locator('body')).toHaveAttribute('data-fiscaliza-ready','true',{timeout:45000});

test('cobertura distingue período, preservação e tentativa; falha tem repetição',async({page})=>{
  let failure=true;
  await page.route('**/data/chunks/fiscalizacao_cidada.json*',route=>failure?route.fulfill({status:503,body:'erro'}):route.continue());
  await page.goto('/prefeitura.html');await ready(page);
  const coverage=page.locator('[data-coverage-content]');await expect(coverage).toContainText('Cobertura indisponível');
  failure=false;await coverage.getByRole('button',{name:'Tentar novamente'}).click();
  await coverage.locator('summary').click();await expect(coverage).toContainText('Última tentativa registrada');await expect(coverage).toContainText('Última coleta completa');await expect(coverage).toContainText('Base anterior preservada');
});
test('cobertura destaca fontes preservadas e publicação não concluída',async({page})=>{
 await page.route('**/operacao.json',route=>route.fulfill({json:{last_completed_run:{coleta:'SUCESSO',deploy:'PENDENTE',fase:'validada',finished_at:'2026-10-30T12:00:00Z'}}}));
 await page.route('**/data/chunks/fiscalizacao_cidada.json*',route=>route.fulfill({json:{schema_version:1,gerado_em:'2026-10-30T12:00:00Z',fontes:[{id:'prefeitura',label:'Prefeitura',status:'preserved',periodo:'Período desconhecido',checked_at:'2026-10-30T11:00:00Z',detalhes:[{conjunto:'Contratos',ultima_completa:'2026-10-01T12:00:00Z',tentativa:'2026-10-30T11:00:00Z'}]}],series:[]}}));
 await page.goto('/prefeitura.html');await ready(page);
 const box=page.locator('[data-coverage-content]');await expect(box).toContainText('1 de 1 fontes');await expect(box).toContainText('atualização ou publicação não confirmada');
 await box.locator('summary').click();await expect(box).toContainText('Última coleta completa:');await expect(box).toContainText('Última tentativa:');
});
test('histórico oferece meses reais e distingue anuais; CSV declara limites',async({page})=>{
  await page.goto('/relatorios.html#evolucao');await ready(page);
  const history=page.locator('[data-evolucao-cidada]');await history.getByRole('button',{name:'Consultar histórico'}).click();
  await expect(history.locator('tbody tr')).not.toHaveCount(0);await expect(history.locator('[data-series-delta]')).toContainText('Registros:');
  await history.locator('[data-series]').selectOption({label:'Prefeitura · Despesas externas consolidadas por ano'});
  await expect(history).toContainText('detalhamento mensal indisponível');await expect(history.locator('[data-series-delta]')).toHaveCount(0);
  const promise=page.waitForEvent('download');await history.getByRole('button',{name:'Baixar CSV desta série'}).click();const file=await (await promise).createReadStream();let text='';for await(const b of file)text+=b;expect(text).toContain('Última tentativa');expect(text).toContain('ano corrente pode estar incompleto');
});
test('acompanhamento persiste, atualiza resposta, escapa conteúdo e exporta',async({page})=>{
  await page.goto('/cobrar.html#acompanhamento');await ready(page);
  const box=page.locator('[data-acompanhamento-cidada]');await box.getByLabel('Assunto',{exact:true}).fill('Contrato <img src=x onerror=alert(1)>');await box.getByLabel('Protocolo oficial').fill('12345');await box.getByLabel('Pergunta enviada').fill('Solicito comprovação da entrega.');
  await box.getByRole('button',{name:'Salvar acompanhamento'}).click();await expect(box.getByRole('status')).toContainText('salvo somente neste navegador');
  await page.reload();await ready(page);await box.getByRole('button',{name:'Atualizar resposta ou protocolo'}).click();await box.getByLabel('Resposta e próxima').fill('Resposta recebida; falta a medição.');await box.getByRole('button',{name:'Salvar acompanhamento'}).click();
  await expect(box.locator('[data-tracking-list]')).toContainText('falta a medição');await expect(box.locator('img')).toHaveCount(0);
  const promise=page.waitForEvent('download');await box.getByRole('button',{name:'Baixar cópia'}).click();expect((await promise).suggestedFilename()).toBe('minhas-cobrancas.json');
});
test('armazenamento bloqueado não anuncia sucesso nem envio',async({page})=>{
  await page.goto('/cobrar.html');await ready(page);await page.evaluate(()=>Storage.prototype.setItem=function(){throw Error('bloqueado');});
  const box=page.locator('[data-acompanhamento-cidada]');await box.getByLabel('Assunto',{exact:true}).fill('Documentos');await box.getByRole('button',{name:'Salvar acompanhamento'}).click();await expect(box.getByRole('status')).toContainText('Não foi possível salvar');
});
test('restauração valida a cópia e preserva os registros atuais',async({page})=>{
  await page.goto('/cobrar.html');await ready(page);const box=page.locator('[data-acompanhamento-cidada]');
  const record={id:'backup-1',assunto:'Medição da obra',orgao:'Prefeitura',protocolo:'ABC',enviado:'',retorno:'',situacao:'aguardando',fonte:'https://example.com/',pedido:'Solicito medição',resposta:''};
  await box.getByLabel('Restaurar uma cópia').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({cobrancas:[record]}))});await expect(box.locator('[data-tracking-list]')).toContainText('Medição da obra');
  await box.getByLabel('Restaurar uma cópia').setInputFiles({name:'invalido.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({cobrancas:[{...record,fonte:'javascript:alert(1)'}]}))});await expect(box.getByRole('status')).toContainText('Os registros atuais foram mantidos');await expect(box.locator('[data-tracking-list]')).toContainText('Medição da obra');
});
test('trilha mostra documentos como pistas e abre cobrança preenchida',async({page})=>{
  await page.goto('/camara.html');await ready(page);
  await page.evaluate(()=>FISCALIZA.dossie.abrirComHtml(FISCALIZA.dossie.templateContrato({contrato:{numero:'5',ano:'2026',contratado:'Empresa teste',valor:100,fonte_url:'https://transparencia.betha.cloud/#/-iAWLe1kr2VQcrW9k2AUBg==/consulta/324812/detalhe/133849:9918:1159_9918'},orgao:'Câmara'})));
  const trail=page.locator('.citizen-trail');await expect(trail).toContainText('Entrega e fiscalização');await expect(trail).toContainText('não comprovam vínculo');
  await trail.getByRole('link',{name:'Acompanhar esta cobrança'}).click();await ready(page);await expect(page.getByLabel('Assunto',{exact:true})).toHaveValue(/Contrato 5\/2026/);await expect(page.getByLabel('Pergunta enviada')).toHaveValue(/termos de recebimento/);await expect(page.locator('[data-tracking-list]')).toContainText('Nenhuma cobrança');
});
test('novas áreas cabem no celular e tabela permite rolagem própria',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/cobrar.html#acompanhamento');await ready(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.goto('/relatorios.html#evolucao');await ready(page);await page.getByRole('button',{name:'Consultar histórico'}).click();await expect(page.locator('[data-series-content] tbody tr').first()).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('catálogo não verificado não afirma que documentos não foram localizados',async({page})=>{
 await page.goto('/prefeitura.html');await ready(page);
 const html=await page.evaluate(()=>FISCALIZA.cidadao.trail({numero:'1',ano:'2026'},'Prefeitura',{status:'nao_verificado'}));
 expect(html).toContain('disponibilidade não confirmada');expect(html).not.toContain('documento desta etapa não localizado no catálogo consultado');
});
test('medicamentos não são classificados como medição de entrega',async({page})=>{
 await page.goto('/prefeitura.html');await ready(page);
 const html=await page.evaluate(()=>FISCALIZA.cidadao.trail({numero:'1',ano:'2026'},'Prefeitura',{status:'disponivel',documentos:[{tipo:'Aditamento',nome:'Distribuição de medicamentos.pdf'},{tipo:'Relatório',nome:'Relatório de medição.pdf'}]}));
 const etapas=await page.evaluate(h=>{const div=document.createElement('div');div.innerHTML=h;return Array.from(div.querySelectorAll('ol > li')).map(x=>x.textContent);},html);
 expect(etapas[4]).toContain('Relatório de medição.pdf');expect(etapas[4]).not.toContain('medicamentos.pdf');
});
