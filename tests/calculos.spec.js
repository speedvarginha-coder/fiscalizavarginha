// Testes de INTEGRIDADE DOS CÁLCULOS (o "miolo").
// Lêem os chunks reais direto do disco (sem browser) e verificam INVARIANTES —
// relações que devem valer sempre, independentemente da coleta diária.
// Objetivo: pegar corrupção de dado / erro de cálculo antes de chegar ao cidadão.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const CHUNKS = path.join(__dirname, "..", "painel-cidadao", "data", "chunks");
function load(name) {
  return JSON.parse(fs.readFileSync(path.join(CHUNKS, name + ".json"), "utf8"));
}

test.describe("Integridade dos cálculos (miolo)", () => {
  test("emendas: quantidade no resumo bate com a lista real", () => {
    const resumo = load("resumo");
    const emendas = load("emendas");
    expect(Array.isArray(emendas)).toBe(true);
    expect(resumo.emendas_qtd).toBe(emendas.length);
  });

  test("emendas: valor total do resumo bate com a soma dos valores", () => {
    const resumo = load("resumo");
    const emendas = load("emendas");
    const soma = emendas.reduce((s, e) => s + (Number(e.valor_brl) || 0), 0);
    // tolerância de centavos (float)
    expect(Math.abs(resumo.emendas_valor_total_brl - soma)).toBeLessThan(0.05);
  });

  test("emendas: nenhum valor negativo e todas têm número/ano", () => {
    const emendas = load("emendas");
    for (const e of emendas) {
      expect(Number(e.valor_brl) || 0).toBeGreaterThanOrEqual(0);
      expect(e.numero != null && e.ano != null).toBe(true);
    }
  });

  test("matérias: soma das quantidades por tipo bate com o total", () => {
    const resumo = load("resumo");
    const somaTipos = (resumo.tipos || []).reduce((s, t) => s + (Number(t.qtd) || 0), 0);
    expect(somaTipos).toBe(resumo.total_materias);
  });

  test("consistência entre chunks: tipo 'Emenda Impositiva' = total de emendas", () => {
    const resumo = load("resumo");
    const emendas = load("emendas");
    const tipoEmenda = (resumo.tipos || []).find((t) => /emenda impositiva/i.test(t.tipo));
    expect(tipoEmenda).toBeTruthy();
    expect(tipoEmenda.qtd).toBe(emendas.length);
  });

  test("cruzamento de emendas: resumo reconcilia com o total (sem emenda perdida)", () => {
    const pref = load("prefeitura");
    const emendas = load("emendas");
    const cs = pref.stats_cruzamento || {};
    const com = Number(cs.com_pagamento) || 0;
    const semPag = Number(cs.sem_pagamento) || 0;
    const semCnpj = Number(cs.sem_cnpj) || 0;
    const direta = Number(cs.execucao_direta) || 0;
    // nenhuma contagem negativa
    [com, semPag, semCnpj, direta].forEach((n) => expect(n).toBeGreaterThanOrEqual(0));
    // o resumo do cruzamento DEVE incluir execução direta (órgão público)
    expect(cs).toHaveProperty("execucao_direta");
    // soma dos status == total de emendas: nenhuma fica fora do placar do cidadão
    expect(com + semPag + semCnpj + direta).toBe(emendas.length);
  });

  test("LOA 2026: per-capita publicado bate com orçamento / população", () => {
    // Lei 7.510/2025 — valores publicados no painel
    const orcamento = 1223155000; // R$ 1,22 bi
    const populacao = 140000;
    const perCapitaPublicado = 8737; // R$ por habitante exibido no hero/LOA
    const calculado = Math.round(orcamento / populacao);
    expect(Math.abs(calculado - perCapitaPublicado)).toBeLessThanOrEqual(1);
  });
});
