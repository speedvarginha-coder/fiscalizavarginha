import { test, expect } from "@playwright/test";
import { fornecedorDaPublicacao, repararNome } from "../scripts/lib/fornecedor-publicacao.mjs";

// O extrato do PDF as vezes comeca no meio da razao social: em 07/2026
// "COLOPLAST DO BRASIL LTDA" virou "DO BRASIL LTDA" e o relatorio atribuiria a
// compra a uma empresa inexistente.

test("recupera o inicio perdido do nome pelo texto do resumo", () => {
  expect(repararNome("DO BRASIL LTDA",
    "compra de proteses da empresa Coloplast do Brasil LTDA."))
    .toBe("Coloplast do Brasil LTDA");
});

test("recupera sigla em caixa alta antes do nome", () => {
  expect(repararNome("HOSPITALAR LTDA",
    "A Prefeitura contratou diretamente a empresa DHN HOSPITALAR LTDA para alugar."))
    .toBe("DHN HOSPITALAR LTDA");
});

test("nao inventa inicio quando o resumo nao cita a empresa", () => {
  expect(repararNome("DO BRASIL LTDA", "compra de tres tendas inflaveis.")).toBe("");
});

test("nao engole a palavra 'empresa' nem o nome do orgao", () => {
  const r = repararNome("HOSPITALAR LTDA",
    "A Prefeitura de Varginha contratou a empresa DHN HOSPITALAR LTDA.");
  expect(r).toBe("DHN HOSPITALAR LTDA");
  expect(r).not.toMatch(/empresa|Prefeitura/i);
});

test("nome inteiro no extrato passa sem reparo", () => {
  expect(fornecedorDaPublicacao({
    envolvidos: [{ papel: "empresa", nome: "TAURUS GERADORES LTDA" }],
    resumo: "O consorcio comprou geradores.",
  })).toEqual({ nome: "TAURUS GERADORES LTDA", origem: "extrato" });
});

test("sem fonte utilizavel devolve vazio, nao um palpite", () => {
  expect(fornecedorDaPublicacao({
    envolvidos: [{ papel: "empresa", nome: "DA SILVA LTDA" }],
    resumo: "O CISSUL/SAMU comprou tres tendas inflaveis personalizadas.",
  }).nome).toBe("");
});

test("nome de orgao nunca e devolvido como fornecedor", () => {
  expect(fornecedorDaPublicacao({
    envolvidos: [],
    resumo: "A Fundacao Hospitalar do Municipio de Varginha LTDA contratou algo.",
  }).nome).toBe("");
});
