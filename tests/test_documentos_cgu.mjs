import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { documentosParaRegistro, renderizar } = require('../painel-cidadao/emendas/documentos-cgu.js');

test('associa somente código integral e CNPJ da mesma pessoa jurídica', () => {
  const record = { tipo: 'Federal', emenda: '202639760006', documentoBeneficiario: '12.345.678/0001-90' };
  const valid = { emenda: '202639760006', cnpj: '12345678000190', documento: 'OB1' };
  const data = { documentos: [valid, { ...valid, cnpj: '12345678000191' }, { ...valid, emenda: '202639760007' }] };
  assert.deepEqual(documentosParaRegistro(record, data), [valid]);
  assert.deepEqual(documentosParaRegistro({ ...record, tipo: 'Municipal' }, data), []);
  assert.deepEqual(documentosParaRegistro({ ...record, documentoBeneficiario: '12345678901' }, data), []);
  assert.deepEqual(documentosParaRegistro({ ...record, emenda: '39760006' }, data), []);
});

test('indica limites, fase e fonte e protege texto vindo dos dados', () => {
  const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const record = { tipo: 'Federal', emenda: '202639760006', documentoBeneficiario: '12345678000190' };
  const data = { coletadoEm: '2026-10-28T12:00:00Z', fontes: [{ ano: 2026 }], documentos: [
    { emenda: record.emenda, cnpj: record.documentoBeneficiario, fase: 'Pagamento', documento: '<OB>', pago: '1500000,00', data: '08/05/2026', anoArquivo: 2026 }
  ] };
  const html = renderizar(record, data, escape);
  assert.match(html, /&lt;OB&gt;/);
  assert.doesNotMatch(html, /<OB>/);
  assert.match(html, /não comprovam crédito/);
  assert.match(html, /emendas-parlamentares-documentos\/2026/);
  assert.match(renderizar(record, null, escape), /indisponíveis/);
});
