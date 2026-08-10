import { test, expect } from "@playwright/test";
import {
  classificarSancao, agruparSancoes, podeNominar, evidenciasFaltantes, CATEGORIAS,
  avaliarIncompatibilidade, raizCnpj,
} from "../scripts/lib/classificar-sancoes.mjs";

// Casos sinteticos, executando a funcao classificadora direto. Um teste que so
// le auditoria_dados.json passa mesmo com a logica quebrada, desde que o JSON
// antigo continue no disco.
//
// O eixo da classificacao e o campo oficial `abrangencia`. Os dois casos reais
// que motivaram isso: inidoneidade da MASTERFER com abrangencia "Na Esfera e no
// Poder do orgao sancionador" (Bahia) e da MORK com "Todas as Esferas em todos
// os Poderes". Mesmo rotulo, alcances opostos.

const completo = {
  base: "ceis",
  id_sancao: 1,
  sancionado: "EMPRESA EXEMPLO LTDA",
  fornecedor_local: "EMPRESA EXEMPLO LTDA",
  cnpj: "00.000.000/0001-00",
  tipo: "Impedimento/proibição de contratar com prazo determinado",
  fundamentacao: "LEI 14133 - ART. 156, III",
  fundamentacao_codigo: "LEI 14133 - ART. 156, III",
  abrangencia: "No órgão sancionador",
  orgao_sancionador: "MMG-PREFEITURA MUNICIPAL DE VARGINHA",
  data_inicio: "01/01/2026",
  data_fim: "01/01/2028",
  numero_processo: "123/2026",
  link_registro: "https://portaldatransparencia.gov.br/sancoes/ceis?id=1",
  verificacao_manual: {
    data_verificacao: new Date().toISOString().slice(0, 10),
    fonte: "Registro individual oficial do CEIS",
    verificado_por: "Teste automatizado",
  },
  sancao_vigente: true,
};

const caso = (extra) => ({ ...completo, ...extra });

test.describe("Alcance vem da abrangencia oficial", () => {
  test("inidoneidade restrita a esfera do orgao NAO e alcance geral", () => {
    // Caso MASTERFER: rotulo diz inidoneidade, abrangencia diz o contrario.
    const r = classificarSancao(caso({
      tipo: "Declaração de Inidoneidade sem prazo determinado",
      abrangencia: "Na Esfera e no Poder do órgão sancionador",
      orgao_sancionador: "Governo do Estado da Bahia (BA)",
    }));
    expect(r.categoria).toBe(CATEGORIAS.OUTRO_ENTE);
    expect(r.nominavel).toBe(false);
  });

  test("inidoneidade com abrangencia geral e alcance geral", () => {
    // Caso MORK.
    const r = classificarSancao(caso({
      tipo: "Declaração de Inidoneidade com prazo determinado",
      abrangencia: "Todas as Esferas em todos os Poderes",
      orgao_sancionador: "Prefeitura Municipal de Itapetininga (SP)",
    }));
    expect(r.categoria).toBe(CATEGORIAS.ALCANCE_GERAL);
    expect(r.nominavel).toBe(true);
  });

  test("impedimento do proprio municipio alcanca Varginha", () => {
    const r = classificarSancao(caso({
      abrangencia: "No órgão sancionador",
      orgao_sancionador: "MMG-PREFEITURA MUNICIPAL DE VARGINHA",
    }));
    expect(r.categoria).toBe(CATEGORIAS.ALCANCE_VARGINHA);
    expect(r.nominavel).toBe(true);
  });

  test("impedimento restrito de outro municipio nao alcanca Varginha", () => {
    const r = classificarSancao(caso({
      abrangencia: "Em todos os Poderes da Esfera do órgão sancionador",
      orgao_sancionador: "PREFEITURA MUNICIPAL DE POUSO NOVO - RS",
    }));
    expect(r.categoria).toBe(CATEGORIAS.OUTRO_ENTE);
  });

  test("abrangencia 'Sem Informacao' cai em revisao humana", () => {
    const r = classificarSancao(caso({ abrangencia: "Sem Informação" }));
    expect(r.categoria).toBe(CATEGORIAS.ALCANCE_DESCONHECIDO);
    expect(r.nominavel).toBe(false);
  });

  test("abrangencia vazia cai em revisao humana", () => {
    const r = classificarSancao(caso({ abrangencia: "" }));
    expect(r.categoria).toBe(CATEGORIAS.ALCANCE_DESCONHECIDO);
  });

  test("abrangencia fora do vocabulario conhecido nao e interpretada", () => {
    const r = classificarSancao(caso({ abrangencia: "Restrito conforme decisao XYZ" }));
    expect(r.categoria).toBe(CATEGORIAS.ALCANCE_DESCONHECIDO);
  });
});

test.describe("Multa e conflito", () => {
  test("multa aplicada por Varginha nunca vira impedimento", () => {
    const r = classificarSancao(caso({
      tipo: "Multa",
      fundamentacao: "LEI 12846 - ART. 6º, I - MULTA",
      fundamentacao_codigo: "LEI 12846 - ART. 6º, I",
      abrangencia: "Todas as Esferas em todos os Poderes",
      orgao_sancionador: "MMG-PREFEITURA MUNICIPAL DE VARGINHA",
    }));
    expect(r.categoria).toBe(CATEGORIAS.MULTA);
    expect(r.nominavel).toBe(false);
  });

  test("tipo multa com fundamentacao de inidoneidade bloqueia", () => {
    const r = classificarSancao(caso({
      tipo: "Multa",
      fundamentacao: "Art. 156, §5º — declaração de inidoneidade",
      fundamentacao_codigo: "LEI 14133 - ART. 156, IV - INIDONEIDADE",
    }));
    expect(r.categoria).toBe(CATEGORIAS.CONFLITO_ENTRE_CAMPOS);
    expect(r.nominavel).toBe(false);
  });
});

test.describe("Dossie minimo antes de nominar", () => {
  test("registro completo com alcance sobre Varginha pode nominar", () => {
    expect(podeNominar(caso({})).permitido).toBe(true);
  });

  test("falta de numero de processo impede nominar", () => {
    const r = podeNominar(caso({ numero_processo: "" }));
    expect(r.permitido).toBe(false);
    expect(r.faltantes).toContain("numero_processo");
  });

  test("'Sem informacao' conta como campo ausente", () => {
    expect(evidenciasFaltantes(caso({ numero_processo: "Sem informação" })))
      .toContain("numero_processo");
  });

  test("falta de link do registro impede nominar", () => {
    expect(podeNominar(caso({ link_registro: "" })).permitido).toBe(false);
  });

  test("sancao de outro ente nunca e nominavel, mesmo com dossie completo", () => {
    const r = podeNominar(caso({
      abrangencia: "No órgão sancionador",
      orgao_sancionador: "PREFEITURA MUNICIPAL DE POUSO NOVO - RS",
    }));
    expect(r.permitido).toBe(false);
  });

  test("sem revisao humana recente nao publica nome", () => {
    const r = podeNominar(caso({ verificacao_manual: null }));
    expect(r.permitido).toBe(false);
    expect(r.faltantes).toContain("verificacao_manual_valida");
  });

  test("revisao humana vencida volta para a fila", () => {
    const r = podeNominar(caso({
      verificacao_manual: {
        data_verificacao: "2025-01-01",
        fonte: "Registro individual oficial do CEIS",
        verificado_por: "Revisor",
      },
    }), { agora: new Date("2026-08-10T12:00:00Z") });
    expect(r.permitido).toBe(false);
    expect(r.faltantes).toContain("verificacao_manual_valida");
  });
});

test.describe("Agrupamento", () => {
  test("nao perde nem duplica registro", () => {
    const entrada = [
      caso({ tipo: "Multa", fundamentacao: "MULTA", fundamentacao_codigo: "MULTA" }),
      caso({ tipo: "Declaração de Inidoneidade", abrangencia: "Todas as Esferas em todos os Poderes" }),
      caso({ abrangencia: "No órgão sancionador", orgao_sancionador: "PREFEITURA DE OUTRO LUGAR" }),
      caso({ abrangencia: "Sem Informação" }),
    ];
    const g = agruparSancoes(entrada);
    expect(Object.values(g).reduce((s, a) => s + a.length, 0)).toBe(entrada.length);
    expect(g[CATEGORIAS.MULTA]).toHaveLength(1);
    expect(g[CATEGORIAS.ALCANCE_GERAL]).toHaveLength(1);
    expect(g[CATEGORIAS.OUTRO_ENTE]).toHaveLength(1);
    expect(g[CATEGORIAS.ALCANCE_DESCONHECIDO]).toHaveLength(1);
  });

  test("agrupamento carrega o veredito de nominacao", () => {
    const [item] = agruparSancoes([caso({ numero_processo: "" })])[CATEGORIAS.ALCANCE_VARGINHA];
    expect(item._pode_nominar).toBe(false);
    expect(item._evidencias_faltantes).toContain("numero_processo");
  });
});

test.describe("Possivel incompatibilidade contratual", () => {
  const contrato = {
    contratado: "EMPRESA EXEMPLO LTDA",
    cnpj: "00.000.000/****-**",
    data_assinatura: "2026-06-01",
    data_fim: "2027-06-01",
    situacao: "EXECUCAO",
  };

  test("raiz de CNPJ ignora o mascaramento da fonte local", () => {
    expect(raizCnpj("00.000.000/****-**")).toBe("00000000");
    expect(raizCnpj("00.000.000/0001-00")).toBe("00000000");
    expect(raizCnpj("123")).toBe("");
  });

  test("todos os elos reunidos formam caso para esclarecimento", () => {
    const r = avaliarIncompatibilidade(caso({}), [contrato]);
    expect(r.caso_para_esclarecimento).toBe(true);
    expect(r.contratos_sobrepostos).toHaveLength(1);
  });

  test("sem contrato local nao levanta caso", () => {
    const r = avaliarIncompatibilidade(caso({}), []);
    expect(r.caso_para_esclarecimento).toBe(false);
    expect(r.elos_faltantes).toContain("contrato_local");
  });

  test("contrato encerrado antes da sancao nao sobrepoe", () => {
    const r = avaliarIncompatibilidade(
      caso({ data_inicio: "01/01/2026" }),
      [{ ...contrato, data_assinatura: "2024-01-01", data_fim: "2025-01-01" }],
    );
    expect(r.caso_para_esclarecimento).toBe(false);
    expect(r.elos_faltantes).toContain("datas_sobrepostas");
  });

  test("sancao de outro ente nao levanta caso mesmo com contrato ativo", () => {
    const r = avaliarIncompatibilidade(
      caso({ orgao_sancionador: "PREFEITURA MUNICIPAL DE POUSO NOVO - RS" }),
      [contrato],
    );
    expect(r.caso_para_esclarecimento).toBe(false);
    expect(r.elos_faltantes).toContain("alcance_atinge_varginha");
  });

  test("dossie incompleto barra o caso mesmo com sobreposicao", () => {
    const r = avaliarIncompatibilidade(caso({ numero_processo: "" }), [contrato]);
    expect(r.caso_para_esclarecimento).toBe(false);
    expect(r.elos_faltantes).toContain("dossie_completo");
  });

  test("sem revisao humana nao levanta incompatibilidade", () => {
    const r = avaliarIncompatibilidade(caso({ verificacao_manual: null }), [contrato]);
    expect(r.caso_para_esclarecimento).toBe(false);
    expect(r.elos_faltantes).toContain("revisao_humana_valida");
  });

  test("CNPJ de raiz diferente nao casa", () => {
    const r = avaliarIncompatibilidade(caso({}), [{ ...contrato, cnpj: "99.999.999/****-**" }]);
    expect(r.caso_para_esclarecimento).toBe(false);
    expect(r.elos_faltantes).toContain("raiz_cnpj_confere");
  });

  test("contrato sem data de fim conta como em aberto", () => {
    const r = avaliarIncompatibilidade(caso({}), [{ ...contrato, data_fim: "" }]);
    expect(r.caso_para_esclarecimento).toBe(true);
  });
});
