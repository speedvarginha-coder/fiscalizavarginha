// @ts-check
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dataDir = path.join(__dirname, "..", "painel-cidadao", "emendas", "data");

function loadPublishedData(file, globalName) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(dataDir, file), "utf8"), context);
  return context.window[globalName];
}

const legacy = loadPublishedData("emendas.js", "EMENDAS_DATA");
const federal = loadPublishedData("emendas_federais.js", "EMENDAS_FEDERAIS");
const municipal = loadPublishedData("emendas_municipais_atuais.js", "EMENDAS_MUNICIPAIS_ATUAIS");
const records = [...legacy.emendas, ...federal.emendas, ...municipal.emendas];

function sourceOf(record) {
  return record.fonteUrl || record.arquivoUrl || record.arquivo
    || (Array.isArray(record.fontes) && record.fontes.length ? record.fontes : "");
}

function money(record, names) {
  const key = names.find((name) => Object.hasOwn(record, name));
  return key && Number.isFinite(Number(record[key])) ? Number(record[key]) : undefined;
}

function validCnpj(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const digit = (base, weights) => {
    const sum = weights.reduce((total, weight, index) => total + Number(base[index]) * weight, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = digit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = digit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits.endsWith(`${first}${second}`);
}

test("totais contam alocação, sem converter desconhecido em zero", () => {
  const allocated = federal.emendas.filter((record) => !record.somenteNoBetha);
  const indicated = federal.emendas.filter((record) => record.somenteNoBetha);
  const allocatedTotal = allocated.reduce((sum, record) => sum + Number(record.valor), 0);

  expect(indicated.length, "deve haver cobertura para indicadas ainda sem pagamento").toBeGreaterThan(0);
  expect(indicated.every((record) => record.valor === 0)).toBeTruthy();
  expect(allocatedTotal).toBeCloseTo(federal.metadata.totalFederal, 2);
  expect(federal.resumoTipos.reduce((sum, item) => sum + item.total, 0)).toBeCloseTo(allocatedTotal, 2);

  const unknownAsZero = records.filter((record) =>
    Number(record.valor) === 0
    && /desconhecid|n[aã]o informad|ignorado/i.test(`${record.valorTexto || ""} ${record.status || ""}`)
  );
  expect(unknownAsZero, "valor desconhecido deve permanecer desconhecido, nao R$ 0").toEqual([]);
});

test("escopo federal e valores monetarios sao coerentes", () => {
  expect(federal.metadata.codigoIbge).toBe("3170701");
  expect(federal.metadata.favorecido).toMatch(/Varginha\s*-\s*MG/i);
  expect(federal.emendas.every((record) => /^VARGINHA(?:\s*[-/]\s*MG)?$/i.test(record.localidade))).toBeTruthy();

  const implausible = records.filter((record) => {
    const value = Number(record.valor);
    return !Number.isFinite(value) || value < 0 || value > 1_000_000_000;
  });
  expect(implausible, "valores devem estar em reais, finitos e em escala municipal plausivel").toEqual([]);
});

test("execucao financeira respeita pago <= liquidado <= empenhado", () => {
  const violations = records.filter((record) => {
    const committed = money(record, ["valorEmpenhado", "empenhado"]);
    const settled = money(record, ["valorLiquidado", "liquidado"]);
    const paid = money(record, ["valorPago", "pago"]);
    return (paid !== undefined && settled !== undefined && paid > settled + 0.01)
      || (settled !== undefined && committed !== undefined && settled > committed + 0.01);
  });
  expect(violations).toEqual([]);
});

test("fontes, documentos, CNPJs e municipal 357 ficam auditaveis", () => {
  const confirmedWithoutSource = records.filter((record) =>
    !sourceOf(record) && /^(confirmad[oa]|recebid[oa]|pago)$/i.test(String(record.status || record.situacao || ""))
  );
  expect(confirmedWithoutSource, "registro sem fonte nao pode ser marcado como confirmado").toEqual([]);

  const duplicates = [legacy.emendas, federal.emendas, municipal.emendas].flatMap((dataset) => {
    const keys = dataset.map((record) =>
      [record.tipo, record.emendaOriginal || record.emenda, record.anoRecurso || record.ano, record.beneficiario, record.valor]
        .map((value) => String(value || "").trim().toUpperCase()).join("|")
    );
    return [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
  });
  expect(duplicates, "duplicatas documentais entre as bases publicadas").toEqual([]);

  const invalidUnmarked = records.filter((record) => {
    const cnpj = record.documentoBeneficiario;
    if (!cnpj || !/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(cnpj) || validCnpj(cnpj)) return false;
    return !/cnpj.{0,20}inv[aá]lid/i.test(JSON.stringify(record));
  });
  expect(invalidUnmarked, "CNPJ invalido deve ser sinalizado no proprio registro").toEqual([]);

  expect(municipal.metadata.totalRegistros).toBe(municipal.emendas.length);
  expect(municipal.emendas.filter((record) => record.emenda === "357/2025")).toHaveLength(1);
  const declaredDivergences = municipal.metadata.divergencias || municipal.metadata.observacoes || [];
  const hasDeclaredDivergence = Array.isArray(declaredDivergences)
    ? declaredDivergences.length > 0
    : String(declaredDivergences).trim().length > 0;
  expect(
    municipal.emendas.length === 357 || hasDeclaredDivergence,
    `base municipal tem ${municipal.emendas.length}/357 registros sem divergencia explicita nos metadados`,
  ).toBeTruthy();
});

test("autoria institucional nao aparece no ranking individual e interface HTTP carrega", async ({ page, request }) => {
  for (const asset of ["/emendas/", "/emendas/app.js", "/emendas/data/emendas_federais.js"]) {
    const response = await request.get(asset);
    expect(response.ok(), `${asset} deve responder via HTTP`).toBeTruthy();
  }

  await page.goto("/emendas/");
  await expect(page.locator("#authorRanking")).not.toBeEmpty();
  const ranking = await page.locator("#authorRanking").innerText();
  expect(ranking).not.toMatch(/BANCADA|COMISS[AÃ]O|RELATOR|INSTITUCIONAL/i);
  await expect(page.locator("body")).not.toContainText(/erro ao carregar/i);
});
