import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Incidente 30/09/2026: um reparo do CSV Betha deixou so os anos 2025/2026 e o
// painel publicou sem 424 contratos plurianuais vigentes (R$ 666 mi), inclusive
// a concessao do transporte. Os testes antigos so conferiam o que existia.
const painel = JSON.parse(fs.readFileSync(new URL("../painel-cidadao/data/chunks/prefeitura_painel.json", import.meta.url), "utf8"));
const contratos = painel.contratos || [];
const hoje = new Date().toISOString().slice(0, 10);
const anoAtual = new Date().getFullYear();
const vigente = c => String(c.data_fim || "").slice(0, 10) >= hoje;

test("base publica mantem contratos vigentes de anos anteriores", () => {
  const plurianuais = contratos.filter(c => Number(c.ano) <= anoAtual - 2 && vigente(c));
  assert.ok(plurianuais.length >= 40, // base restaurada tem 83; a base com a falha tinha 0
    `so ${plurianuais.length} contratos vigentes de licitacoes anteriores a ${anoAtual - 1}; a coleta perdeu os plurianuais`);
});

test("o maior contrato vigente da base nao e menor que R$ 100 mi", () => {
  const maior = Math.max(0, ...contratos.filter(vigente).map(c => Number(c.valor) || 0));
  assert.ok(maior >= 100e6, `maior contrato vigente: R$ ${maior}; concessoes de longo prazo ausentes`);
});

test("nenhum contrato publicado esta vazio", () => {
  const vazios = contratos.filter(c => !(c.numero || c.objeto || c.cnpj));
  assert.equal(vazios.length, 0, `${vazios.length} registros sem numero, objeto e CNPJ`);
});
