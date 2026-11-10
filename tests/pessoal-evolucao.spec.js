const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
test.use({ serviceWorkers: 'block' });
const row = (nome, matricula, competencia, vencimentos, com = false, extra = {}) => ({
  nome, matricula, competencia, vencimentos, liquido: vencimentos * .8,
  cargo: 'Analista', lotacao: 'Administração', comissionado_ou_similar: com, ...extra,
});
const org = (competencia, servidores, camara = false) => ({ competencia, servidores,
  fonte: `https://transparencia.betha.cloud/#/portal/consulta/${camara ? '324807' : '97583'}`,
  coletado_em: '2026-10-08T06:43:57-03:00' });
const setembro = { competencia: '09/2026',
  prefeitura: org('09/2026', [row('Ana Exemplo', '1', '09/2026', 200, true), row('Lia Mesmo', '', '09/2026', 80), row('Davi Exemplo', '9', '09/2026', 400, false, {cargo:'1 - SECRETARIO SAUDE'})]),
  camara: org('09/2026', [row('Carla Exemplo', '3', '09/2026', 100, true)], true),
};
const agosto = { competencia: '08/2026',
  prefeitura: org('08/2026', [row('Ana Exemplo', '1', '08/2026', 100, true), row('Lia Mesmo', '11', '08/2026', 40), row('Lia Mesmo', '12', '08/2026', 50), row('Davi Exemplo', '9', '08/2026', 350, false, {cargo:'1 - SECRETARIO SAUDE'})]),
  camara: org('08/2026', [row('Carla Exemplo', '3', '08/2026', 0, true), row('Lia Mesmo', '16', '08/2026', 999)], true),
};
async function abrir(page) {
  await page.route('**/data/chunks/pessoal.json', r => r.fulfill({ json: setembro }));
  await page.route('**/data/chunks/pessoal_historico.json', r => r.fulfill({ json: { competencias: ['08/2026','09/2026'].map(mes => ({ competencia: mes, chunk: `pessoal_folha_2026_${mes.slice(0,2)}`, orgaos: { prefeitura: { registros: 1 } } })) } }));
  await page.route('**/data/chunks/pessoal_folha_2026_08.json', r => r.fulfill({ json: agosto }));
  await page.route('**/data/chunks/pessoal_folha_2026_09.json', r => r.fulfill({ json: setembro }));
  await page.goto('/pessoal.html');
  await expect(page.locator('#listaPessoal article')).toHaveCount(4);
  await expect(page.locator('#compararMesPessoal option[value="08/2026"]')).toBeAttached();
}

test('ranking, proporção e primeiro escalão acompanham a competência escolhida', async ({ page }) => {
  await abrir(page);
  await expect(page.locator('#rankingComissionados article').first()).toContainText('200,00');
  await page.locator('#filtroMesPessoal').selectOption('08/2026');
  await expect(page.locator('#rankingPeriodoInfo')).toContainText('08/2026');
  await expect(page.locator('#rankingPeriodoInfo')).not.toContainText('09/2026');
  await expect(page.locator('#rankingComissionados article').first()).toContainText('100,00');
  await expect(page.locator('#primeiroEscalao')).toContainText('350,00');
  await expect(page.locator('#comparativoPeriodoInfo')).toContainText('08/2026');
  await expect(page.locator('#comparativoComissionados')).toContainText('1 comissionados de 4 registros');
});

test('comparação segue os filtros e trata base zero e recorte vazio', async ({ page }) => {
  await abrir(page);
  await page.locator('#buscaServidor').fill('Ana');
  await page.locator('#compararMesPessoal').selectOption('08/2026');
  await expect(page.locator('#pessoalComparacao')).toContainText('+R$ 100,00 (+100%)');
  await expect(page.locator('#pessoalComparacao')).toContainText('+R$ 80,00 (+100%)');
  await page.locator('#buscaServidor').fill('Carla');
  await expect(page.locator('#pessoalComparacao')).toContainText('percentual não calculável com base zero');
  await expect(page.locator('#pessoalComparacao')).not.toContainText('Infinity');
  await page.locator('#buscaServidor').fill('Ninguém');
  await expect(page.locator('#pessoalComparacao')).toContainText('comparação indisponível');
});

test('histórico mantém homônimos separados e não mistura órgãos', async ({ page }) => {
  await abrir(page);
  await page.locator('#buscaServidor').fill('Lia');
  await page.locator('#listaPessoal').getByRole('button', { name: 'Ver histórico de Lia Mesmo' }).click();
  const modal = page.getByRole('dialog', {name:'Histórico de Lia Mesmo'});
  await expect(modal.getByRole('status')).toContainText('Consulta concluída');
  await expect(modal).toContainText('40,00');
  await expect(modal).toContainText('50,00');
  await expect(modal).not.toContainText('999,00');
  await expect(modal).toContainText('Por nome; vínculo não confirmado');
  await expect(modal.locator('tbody tr')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
});

test('histórico confirma matrícula quando disponível e CSV inclui proveniência', async ({ page }) => {
  await abrir(page);
  await page.locator('#buscaServidor').fill('Ana');
  await page.locator('#listaPessoal').getByRole('button', { name: 'Ver histórico de Ana Exemplo' }).click();
  await expect(page.locator('#modalFiscaliza').getByRole('status')).toContainText('Consulta concluída');
  await expect(page.locator('#modalFiscaliza')).toContainText('Matrícula correspondente no mesmo órgão');
  await page.keyboard.press('Escape');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '↓ CSV', exact: true }).click();
  const csv = fs.readFileSync(await (await downloaded).path(), 'utf8');
  expect(csv).toContain('Fonte oficial');
  expect(csv).toContain('https://transparencia.betha.cloud/#/portal/consulta/97583');
  expect(csv).toContain('2026-10-08T06:43:57-03:00');
  expect(csv).toContain('09/2026');
  expect(csv).toContain('Data da coleta registrada');
});

test('falha e retomada do mês não mantêm ranking de outra competência', async ({ page }) => {
  await abrir(page);
  let falhar = true;
  await page.route('**/data/chunks/pessoal_folha_2026_08.json', r => falhar ? r.fulfill({status:503}) : r.fulfill({json:agosto}));
  await page.locator('#filtroMesPessoal').selectOption('08/2026');
  await expect(page.locator('#rankingComissionados')).toContainText('Não foi possível carregar');
  await expect(page.locator('#rankingComissionados')).not.toContainText('200,00');
  falhar = false;
  await page.locator('#listaPessoal').getByRole('button', {name:'Tentar novamente'}).click();
  await expect(page.locator('#rankingComissionados article').first()).toContainText('100,00');
});
