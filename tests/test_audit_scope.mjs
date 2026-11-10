import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocksAuditScope } from '../scripts/lib/audit-scope.mjs';
test('rotina financeira mantém alerta editorial sem descartar dados financeiros válidos', () => {
  const issue = { id: 'publicacoes-camara-defasadas', severity: 'error' };
  assert.equal(blocksAuditScope(issue), true);
  assert.equal(blocksAuditScope(issue, 'financial'), false);
  assert.equal(issue.severity, 'error');
  assert.equal(blocksAuditScope({ id: 'diarias-ausente', severity: 'error' }, 'financial'), true);
  assert.equal(blocksAuditScope({ id: 'diarias-prefeitura-queda-anormal', severity: 'error' }, 'financial'), true);
  assert.throws(() => blocksAuditScope(issue, 'other'));
});
