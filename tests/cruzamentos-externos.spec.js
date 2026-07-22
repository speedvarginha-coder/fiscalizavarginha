// Testes de INTEGRIDADE dos 3 chunks de cruzamento externo (sanções CEIS/CNEP,
// doações TSE, resultados de licitação PNCP). Mesmo espírito de calculos.spec.js:
// lêem os chunks reais do disco, sem browser — pegam corrupção de dado antes de
// chegar ao cidadão. Motivo de existir: incidente real de 20/07/2026 em que
// licitacoes_resultados.json caiu de 302 para 0 compras (API externa devolveu
// vazio numa falha transitória) e foi publicado por um ciclo antes de alguém
// notar. A guarda de schema em validar_schemas_dados.py cobre a regressão de
// volume; estes testes cobrem a FORMA dos dados que o site realmente consome.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const CHUNKS = path.join(__dirname, "..", "painel-cidadao", "data", "chunks");
function load(name) {
  return JSON.parse(fs.readFileSync(path.join(CHUNKS, name + ".json"), "utf8"));
}

test.describe("Explicabilidade dos cruzamentos", () => {
  test("alertas sensiveis publicam metodo, confianca, evidencias e limitacoes", () => {
    const auditoria = load("auditoria_dados");
    const ids = new Set([
      "camara-despesa-sem-contrato",
      "prefeitura-despesa-sem-contrato",
      "emendas-sem-repasses",
      "fornecedor-inidoneo",
      "fornecedor-sancionado-outro-ente",
      "socios-em-comum",
      "doador-fornecedor",
    ]);
    const sensiveis = (auditoria.items || []).filter((item) => ids.has(item.id));
    expect(sensiveis.length).toBeGreaterThan(0);
    for (const item of sensiveis) {
      expect(item.verification, `${item.id}: verification ausente`).toBeTruthy();
      expect(item.verification.metodo, `${item.id}: metodo ausente`).toBeTruthy();
      expect(item.verification.confianca, `${item.id}: confianca ausente`).toBeTruthy();
      expect(Array.isArray(item.verification.evidencias)).toBe(true);
      expect(item.verification.evidencias.length).toBeGreaterThan(0);
      expect(Array.isArray(item.verification.limitacoes)).toBe(true);
      expect(item.verification.limitacoes.length).toBeGreaterThan(0);
    }
  });
});

test.describe("Integridade — Sanções CEIS/CNEP", () => {
  test("estrutura básica: contadores numéricos e achados é lista", () => {
    const s = load("sancoes");
    expect(typeof s.verificados).toBe("number");
    expect(typeof s.consultas_api).toBe("number");
    expect(typeof s.sancoes_vigentes).toBe("number");
    expect(Array.isArray(s.achados)).toBe(true);
  });

  test("sancoes_vigentes nunca é maior que o total de achados", () => {
    const s = load("sancoes");
    expect(s.sancoes_vigentes).toBeLessThanOrEqual(s.achados.length);
  });

  test("todo achado tem os campos essenciais para publicação responsável", () => {
    const s = load("sancoes");
    for (const a of s.achados) {
      expect(a.fornecedor_local, "fornecedor_local ausente").toBeTruthy();
      expect(a.cnpj, "cnpj ausente — achado nao verificavel").toBeTruthy();
      expect(a.tipo, "tipo de sancao ausente").toBeTruthy();
      expect(a.orgao_sancionador, "orgao_sancionador ausente").toBeTruthy();
      expect(typeof a.sancao_vigente).toBe("boolean");
    }
  });

  test("achados verificados manualmente carregam o registro de verificação (rastreabilidade)", () => {
    const s = load("sancoes");
    const verificacoes = JSON.parse(
      fs.readFileSync(path.join(CHUNKS, "..", "verificacoes_manuais.json"), "utf8")
    );
    const raizesVerificadas = new Set(
      verificacoes.verificacoes.map((v) => v.cnpj_raiz)
    );
    const comVerificacao = s.achados.filter((a) => a.verificacao_manual);
    // Toda raiz cadastrada em verificacoes_manuais.json que aparecer nos
    // achados DEVE trazer o registro anexado — senão a mesclagem quebrou.
    const raizesNosAchados = new Set(
      s.achados.map((a) => (a.cnpj || "").replace(/\D/g, "").slice(0, 8))
    );
    const deveriamTerVerificacao = [...raizesVerificadas].filter((r) => raizesNosAchados.has(r));
    if (deveriamTerVerificacao.length > 0) {
      expect(comVerificacao.length).toBeGreaterThan(0);
      for (const a of comVerificacao) {
        expect(a.verificacao_manual.data_verificacao, "verificacao sem data").toBeTruthy();
        expect(a.verificacao_manual.fonte, "verificacao sem fonte").toBeTruthy();
      }
    }
  });
});

test.describe("Integridade — Doações TSE 2024", () => {
  test("estrutura básica: eleitos numérico e candidatos é lista do mesmo tamanho", () => {
    const t = load("tse_doacoes");
    expect(typeof t.eleitos).toBe("number");
    expect(Array.isArray(t.candidatos)).toBe(true);
    expect(t.candidatos.length).toBe(t.eleitos);
  });

  test("todo candidato tem nome, cargo e lista de doadores", () => {
    const t = load("tse_doacoes");
    for (const c of t.candidatos) {
      expect(c.nome_urna, "nome_urna ausente").toBeTruthy();
      expect(c.cargo, "cargo ausente").toBeTruthy();
      expect(Array.isArray(c.doadores), "doadores nao e lista").toBe(true);
    }
  });

  test("doador com CPF/CNPJ vem mascarado (LGPD)", () => {
    const t = load("tse_doacoes");
    for (const c of t.candidatos) {
      for (const d of c.doadores) {
        if (d.cpf_cnpj) {
          expect(d.cpf_cnpj).toMatch(/\*/);
        }
      }
    }
  });
});

test.describe("Integridade — Resultados de licitação PNCP", () => {
  test("estrutura básica: compras numérico bate com o tamanho de registros", () => {
    const l = load("licitacoes_resultados");
    expect(typeof l.compras).toBe("number");
    expect(Array.isArray(l.registros)).toBe(true);
    expect(l.registros.length).toBe(l.compras);
  });

  test("todo registro tem órgão, objeto e lista de resultados", () => {
    const l = load("licitacoes_resultados");
    for (const r of l.registros) {
      expect(r.orgao, "orgao ausente").toBeTruthy();
      expect(r.objeto, "objeto ausente").toBeTruthy();
      expect(Array.isArray(r.resultados), "resultados nao e lista").toBe(true);
    }
  });

  test("toda homologação simbólica referencia um vencedor e valores coerentes", () => {
    const l = load("licitacoes_resultados");
    for (const h of l.homologacoes_simbolicas || []) {
      expect(h.vencedor, "homologacao simbolica sem vencedor").toBeTruthy();
      expect(Number(h.valor_homologado)).toBeGreaterThan(0);
      expect(Number(h.valor_estimado)).toBeGreaterThan(Number(h.valor_homologado));
    }
  });
});
