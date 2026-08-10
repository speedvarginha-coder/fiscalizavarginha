import { test, expect } from "@playwright/test";
import {
  semanaAnterior, mesAnterior, agregarPeriodo, explicarAusencia,
} from "../scripts/lib/resumo-periodo.mjs";

test.describe("Janelas de periodo", () => {
  test("semana anterior e segunda a domingo fechados", () => {
    // 04/08/2026 e terca. A semana fechada anterior vai de 27/07 a 02/08.
    expect(semanaAnterior(new Date("2026-08-04"))).toMatchObject({
      inicio: "2026-07-27", fim: "2026-08-02", tipo: "semanal",
    });
  });

  test("semana anterior a uma segunda nao inclui o proprio dia", () => {
    const r = semanaAnterior(new Date("2026-08-03"));
    expect(r.fim < "2026-08-03").toBe(true);
  });

  test("mes anterior e o mes fechado", () => {
    expect(mesAnterior(new Date("2026-08-04"))).toMatchObject({
      inicio: "2026-07-01", fim: "2026-07-31", tipo: "mensal",
    });
  });

  test("mes anterior atravessa a virada de ano", () => {
    expect(mesAnterior(new Date("2026-01-15"))).toMatchObject({
      inicio: "2025-12-01", fim: "2025-12-31",
    });
  });
});

test.describe("Explicacao de ausencia legislativa", () => {
  const sessoes = [
    { data: "2026-07-13" }, { data: "2026-07-15" }, { data: "2026-08-03" },
  ];

  test("sem materia e sem sessao aponta a sessao anterior e a proxima", () => {
    const r = explicarAusencia({
      materias: [], sessoes, inicio: "2026-07-27", fim: "2026-08-02",
    });
    expect(r.motivo).toBe("sem_sessao_no_periodo");
    expect(r.sessao_anterior).toBe("2026-07-15");
    expect(r.sessao_posterior).toBe("2026-08-03");
  });

  test("sessao sem materia e distinguido de ausencia de sessao", () => {
    const r = explicarAusencia({
      materias: [], sessoes, inicio: "2026-07-13", fim: "2026-07-15",
    });
    expect(r.motivo).toBe("sessoes_sem_materia");
    expect(r.texto).toMatch(/nenhuma matéria nova foi protocolada/i);
  });

  test("com materia nao ha o que explicar", () => {
    expect(explicarAusencia({
      materias: [{ id: 1 }], sessoes, inicio: "2026-07-01", fim: "2026-07-31",
    })).toBeNull();
  });

  test("a explicacao nao afirma recesso — so fatos observaveis", () => {
    const r = explicarAusencia({
      materias: [], sessoes, inicio: "2026-07-27", fim: "2026-08-02",
    });
    // "Recesso" e regime juridico; a base registra sessao, nao regime.
    expect(r.texto).not.toMatch(/recesso/i);
  });
});

test.describe("Agregacao", () => {
  const chunks = {
    camaraAnos: {
      2026: {
        vereadores: [{ nome: "Fulano de Tal" }, { nome: "Beltrana Silva" }],
        materias: [
          { data: "2026-07-05", autor: "Fulano de Tal", sigla: "IND", tipo: "Indicação" },
          { data: "2026-07-06", autor: "Prefeito Municipal", sigla: "PLOE", tipo: "Projeto do Executivo" },
          { data: "2026-07-07", autor: "Fulano de Tal, Beltrana Silva", sigla: "REQ", tipo: "Requerimento" },
        ],
        sessoes: [{ data: "2026-07-06" }],
      },
    },
    prefeitura: {
      contratos: [
        { data_assinatura: "2026-07-10", valor: 1000, modalidade: "Dispensa eletrônica" },
        { data_assinatura: "2026-06-10", valor: 9999, modalidade: "Pregão eletrônico" },
      ],
      licit_finalizadas: [{ data: "2026-07-11", valor: 500 }],
      licit_andamento: [],
    },
    camaraBetha: { contratos: [], licitacoes: [] },
    publicacoesDiario: {
      publicacoes: [
        { data: "2026-07-12", tipo: "dispensa", valores: { total: 250 } },
        { data: "2026-07-12", tipo: "pessoal", valores: { total: 999 } },
      ],
    },
  };

  const r = agregarPeriodo(chunks, "2026-07-01", "2026-07-31");

  test("matéria do Executivo entra no total mas fica fora do ranking", () => {
    expect(r.legislativo.materias_total).toBe(3);
    expect(r.legislativo.materias_de_vereadores).toBe(2);
    expect(r.legislativo.ranking.map((v) => v.nome)).not.toContain("Prefeito Municipal");
  });

  test("coautoria conta para os dois autores", () => {
    const fulano = r.legislativo.ranking.find((v) => v.nome === "Fulano de Tal");
    const beltrana = r.legislativo.ranking.find((v) => v.nome === "Beltrana Silva");
    expect(fulano.total).toBe(2);
    expect(beltrana.total).toBe(1);
  });

  test("contrato fora do periodo nao entra", () => {
    expect(r.compras.contratos_prefeitura).toHaveLength(1);
    expect(r.compras.valor_contratos_prefeitura).toBe(1000);
  });

  test("so dispensa e inexigibilidade contam como contratacao direta", () => {
    expect(r.compras.contratacao_direta_publicada).toHaveLength(1);
    expect(r.compras.valor_contratacao_direta).toBe(250);
  });

  test("modalidade e agregada por quantidade e valor", () => {
    expect(r.compras.por_modalidade["Dispensa eletrônica"]).toEqual({ qtd: 1, valor: 1000 });
  });
});
