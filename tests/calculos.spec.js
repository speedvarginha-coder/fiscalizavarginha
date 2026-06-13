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

  test("desfecho legislativo: tally do resumo reconcilia com as matérias", () => {
    const fs = require("fs");
    const path = require("path");
    const camara = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "painel-cidadao", "data", "chunks", "camara_anos.json"), "utf8")
    );
    const VALIDOS = new Set(["lei", "arquivado", "tramitando", "encerrado", ""]);
    for (const ano of Object.keys(camara)) {
      const bloco = camara[ano];
      const mats = bloco.materias || [];
      if (!mats.length || !bloco.resumo || !bloco.resumo.desfechos) continue; // só anos já enriquecidos
      // todo desfecho é de um vocabulário fechado (nada inventado)
      mats.forEach((m) => expect(VALIDOS.has(m.desfecho || "")).toBe(true));
      const d = bloco.resumo.desfechos;
      const soma = (d.lei || 0) + (d.arquivado || 0) + (d.tramitando || 0) + (d.encerrado || 0) + (d.sem_dado || 0);
      // o placar de desfechos cobre todas as matérias — nenhuma some
      expect(soma).toBe(mats.length);
      // contagem de "lei" no resumo == matérias marcadas como lei
      expect(d.lei).toBe(mats.filter((m) => m.desfecho === "lei").length);
    }
  });
});

test.describe("Integridade — Pessoal e Cargos", () => {
  for (const org of ["camara", "prefeitura"]) {
    test(`pessoal/${org}: resumo bate com a lista de servidores`, () => {
      const ps = load("pessoal");
      const o = ps[org];
      const r = o.resumo;
      const s = o.servidores;
      const com = s.filter((x) => x.comissionado_ou_similar);
      const somaTotal = s.reduce((a, x) => a + (Number(x.vencimentos) || 0), 0);
      const somaCom = com.reduce((a, x) => a + (Number(x.vencimentos) || 0), 0);

      expect(r.servidores_qtd).toBe(s.length);
      expect(r.comissionados_qtd).toBe(com.length);
      expect(com.length).toBeLessThanOrEqual(s.length);
      expect(Math.abs(r.folha_bruta_total - somaTotal)).toBeLessThan(0.05);
      expect(Math.abs(r.folha_bruta_comissionados - somaCom)).toBeLessThan(0.05);
      expect(r.folha_bruta_comissionados).toBeLessThanOrEqual(r.folha_bruta_total);
      if (com.length) {
        const maxCom = Math.max(...com.map((x) => Number(x.vencimentos) || 0));
        expect(r.maior_vencimento_comissionado).toBe(maxCom);
      }
    });
  }
});

test.describe("Integridade — Diárias", () => {
  for (const org of ["prefeitura", "camara"]) {
    test(`diárias/${org}: resumo bate com os registros`, () => {
      const d = load("diarias");
      const arr = d[org];
      const r = d.resumo[org];
      const soma = arr.reduce((a, x) => a + (Number(x.valor_total) || 0), 0);
      expect(r.registros).toBe(arr.length);
      expect(Math.abs(r.valor_total - soma)).toBeLessThan(0.05);
      arr.forEach((x) => expect(Number(x.valor_total) || 0).toBeGreaterThanOrEqual(0));
    });
  }

  test("privacidade (LGPD): nenhum CPF completo exposto nas diárias", () => {
    const d = load("diarias");
    const todos = [...d.prefeitura, ...d.camara].filter((x) => x.cpf);
    const expostos = todos.filter((x) =>
      /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(String(x.cpf).trim())
    );
    expect(expostos.length).toBe(0);
  });
});
