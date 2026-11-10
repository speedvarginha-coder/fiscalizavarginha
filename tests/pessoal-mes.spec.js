const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
test.use({ serviceWorkers: 'block' });

const servidor = (nome, matricula, competencia, vencimentos, comissionado = false) => ({
  nome, matricula, competencia, vencimentos, liquido: vencimentos - 10,
  cargo: 'Analista', lotacao: 'Administração', comissionado_ou_similar: comissionado,
});
const folha = {
  prefeitura: { competencia: '09/2026', resumo: {}, servidores: [
    servidor('Ana Teste', '1', '08/2026', 90),
    servidor('Ana Teste', '1', '09/2026', 100),
    servidor('Bruno Teste', '2', '09/2026', 300, true),
  ] },
  camara: { competencia: '08/2026', resumo: {}, servidores: [servidor('Carla Teste', '3', '08/2026', 50)] },
};

async function abrir(page, query = '') {
  await page.route('**/data/chunks/pessoal_historico.json', route => route.fulfill({ json: { competencias: [] } }));
  await page.route('**/data/chunks/pessoal.json', route => route.fulfill({ json: folha }));
  await page.goto('/pessoal.html' + query);
  await expect(page.locator('#listaPessoal article')).toHaveCount(query ? 1 : 3);
}

test('mês filtra antes de consolidar e combina nome, órgão e vínculo', async ({ page }) => {
  await abrir(page);
  const mes = page.getByRole('combobox', { name: 'Filtrar por mês da folha' });
  await expect(mes.locator('option')).toHaveText(['Último registro de cada vínculo', 'setembro/2026', 'agosto/2026']);
  await expect(page.locator('#listaPessoal article').filter({ hasText: 'Carla Teste' })).toContainText('08/2026');
  await mes.selectOption('08/2026');
  await expect(page.locator('#listaPessoal article')).toHaveCount(2);
  await expect(page.locator('#listaPessoal article').filter({ hasText: 'Ana Teste' })).toContainText('R$ 90,00');
  await expect(page.locator('#totServidores')).toHaveText('2');
  await page.locator('#buscaServidor').fill('Ana');
  await expect(page.locator('#pessoalContador')).toHaveText('1 registro(s) encontrado(s)');
  await page.locator('#filtroTipo').selectOption('comissionado');
  await expect(page.locator('#pessoalEmpty')).toBeVisible();
  await expect(page.locator('#pessoalEmpty')).toContainText('Não há registros');
  await page.locator('#filtroTipo').selectOption('');
  await page.locator('#buscaServidor').fill('');
  await page.locator('#filtroOrgao').selectOption('camara');
  await expect(page.locator('#listaPessoal article')).toHaveCount(1);
  await mes.selectOption('09/2026');
  await expect(page.locator('#listaPessoal article')).toHaveCount(0);
  await expect(page.locator('#pessoalCompetencia')).toContainText('Câmara: sem registros coletados neste mês');
  await mes.selectOption('');
  await expect(page.locator('#listaPessoal article')).toHaveCount(1);
  await expect(page.locator('#listaPessoal')).toContainText('Carla Teste');
});

test('mês na URL e CSV preservam a competência selecionada', async ({ page }) => {
  await abrir(page, '?mes=08%2F2026&orgao=prefeitura&q=Ana');
  await expect(page.locator('#filtroMesPessoal')).toHaveValue('08/2026');
  await expect(page.locator('#listaPessoal')).toContainText('R$ 90,00');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '↓ CSV', exact: true }).click();
  const download = await downloading;
  const csv = fs.readFileSync(await download.path(), 'utf8');
  expect(csv).toContain('Competência');
  expect(csv).toContain('08/2026');
  expect(csv).not.toContain('09/2026');
  expect(csv).not.toContain('Bruno Teste');
});

test('mês real disponível funciona no celular sem criar histórico', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dados = await (await request.get('/data/chunks/pessoal.json')).json();
  const indice = await (await request.get('/data/chunks/pessoal_historico.json')).json();
  await page.goto('/pessoal.html');
  await expect(page.locator('#listaPessoal article').first()).toBeVisible();
  await expect(page.locator('#filtroMesPessoal option')).toHaveCount(indice.competencias.length + 1);
  const opcoes = await page.locator('#filtroMesPessoal option').evaluateAll(items => items.map(item => item.value).filter(Boolean));
  const meses = [...new Set([...indice.competencias.map(c => c.competencia), ...['prefeitura', 'camara'].flatMap(orgao => dados[orgao].servidores.map(s => s.competencia || dados[orgao].competencia))].filter(Boolean))];
  expect(opcoes.sort()).toEqual(meses.sort());
  await page.getByRole('button', { name: 'Filtrar salários por mês, nome ou órgão' }).click();
  await page.locator('#filtroMesPessoal').selectOption(opcoes[0]);
  await page.getByRole('button', { name: 'Ver resultados', exact: true }).click();
  await expect(page.locator('#filtroMesPessoal')).not.toBeVisible();
  await expect(page.locator('#pessoalCompetencia')).toContainText('Mês selecionado');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('histórico real carrega sob demanda e preserva todos os registros de agosto', async ({ page, request }) => {
  const pedidos = [];
  page.on('request', r => pedidos.push(new URL(r.url()).pathname));
  const mensal = await (await request.get('/data/chunks/pessoal_folha_2026_08.json')).json();
  await page.goto('/pessoal.html');
  await expect(page.locator('#filtroMesPessoal option[value="01/2026"]')).toBeAttached();
  expect(pedidos.some(p => p.includes('/pessoal_folha_'))).toBe(false);
  await page.locator('#filtroOrgao').selectOption('prefeitura');
  await page.locator('#filtroMesPessoal').selectOption('08/2026');
  await expect(page.locator('#pessoalContador')).toHaveText(`${mensal.prefeitura.servidores.length} registro(s) encontrado(s)`);
  await expect(page.locator('#listaPessoal article').first()).toContainText('08/2026');
  expect(pedidos).toContain('/data/chunks/pessoal_folha_2026_08.json');
  await page.locator('#filtroMesPessoal').selectOption('09/2026');
  await expect(page.locator('#listaPessoal article').first()).toContainText('09/2026');
});

test('falha do histórico não apresenta outro mês e permite nova tentativa', async ({ page }) => {
  const historica = { competencia: '07/2026', prefeitura: { servidores: [servidor('Ana Histórica', '1', '07/2026', 70)] }, camara: { servidores: [] } };
  await page.route('**/data/chunks/pessoal.json', route => route.fulfill({ json: folha }));
  await page.route('**/data/chunks/pessoal_historico.json', route => route.fulfill({ json: { competencias: [{ competencia: '07/2026', chunk: 'pessoal_folha_2026_07', orgaos: { prefeitura: { registros: 1 } } }] } }));
  let tentativas = 0;
  await page.route('**/data/chunks/pessoal_folha_2026_07.json', route => ++tentativas === 1 ? route.fulfill({ status: 503 }) : route.fulfill({ json: historica }));
  await page.goto('/pessoal.html?mes=07%2F2026');
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).waitFor();
  await expect(page.getByRole('button', { name: '↓ CSV', exact: true })).toBeDisabled();
  await expect(page.locator('#listaPessoal article')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.locator('#listaPessoal')).toContainText('R$ 70,00');
  await expect(page.getByRole('button', { name: '↓ CSV', exact: true })).toBeEnabled();
});

test('resposta histórica atrasada não substitui o mês escolhido depois', async ({ page }) => {
  let liberar;
  const espera = new Promise(resolve => { liberar = resolve; });
  await page.route('**/data/chunks/pessoal_folha_2026_08.json', async route => { await espera; await route.continue(); });
  try {
    await page.goto('/pessoal.html');
    await expect(page.locator('#filtroMesPessoal option[value="01/2026"]')).toBeAttached();
    await page.locator('#filtroMesPessoal').selectOption('08/2026');
    await expect(page.locator('#pessoalContador')).toHaveText('Carregando mês selecionado…');
    await page.locator('#filtroMesPessoal').selectOption('09/2026');
    liberar();
    await expect(page.locator('#listaPessoal article').first()).toContainText('09/2026');
    await expect(page.locator('#pessoalCompetencia')).toContainText('setembro/2026');
  } finally { liberar(); }
});
