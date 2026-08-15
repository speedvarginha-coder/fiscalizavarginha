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

function money(record, names) {
  const key = names.find((name) => Object.hasOwn(record, name));
  if (!key || record[key] === null || record[key] === undefined || record[key] === "") return undefined;
  return Number.isFinite(Number(record[key])) ? Number(record[key]) : undefined;
}

function validCnpj(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const digit = (base, weights) => {
    const sum = weights.reduce((total, weight, index) => total + Number(base[index]) * weight, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return digits.endsWith(`${digit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}${digit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`);
}

function municipalKey(record) {
  const value = String(record.emendaOriginal || record.emenda || "");
  const match = value.match(/(\d{1,4})\s*\/\s*(20\d{2})/);
  return match ? `${match[1].padStart(3, "0")}/${match[2]}` : value.toUpperCase();
}

const legacy = loadPublishedData("emendas.js", "EMENDAS_DATA");
const federal = loadPublishedData("emendas_federais.js", "EMENDAS_FEDERAIS");
const estadual = loadPublishedData("emendas_estaduais_normalizadas.js", "EMENDAS_ESTADUAIS_NORMALIZADAS");
const municipal = loadPublishedData("emendas_municipais_unificadas.js", "EMENDAS_MUNICIPAIS_UNIFICADAS");
const records = [
  ...legacy.emendas.filter((record) => !["Municipal", "Estadual"].includes(record.tipo)),
  ...estadual.emendas,
  ...municipal.emendas,
  ...federal.emendas,
];

test("totais federais contam agregados sem converter desconhecido em zero", () => {
  const allocated = federal.emendas.filter((record) => !record.somenteNoBetha);
  const indicated = federal.emendas.filter((record) => record.somenteNoBetha);
  const allocatedTotal = allocated.reduce((sum, record) => sum + Number(record.valor), 0);

  expect(indicated.length).toBeGreaterThan(0);
  expect(indicated.every((record) => record.valor === 0)).toBeTruthy();
  expect(allocatedTotal).toBeCloseTo(federal.metadata.totalFederal, 2);
  expect(federal.resumoTipos.reduce((sum, item) => sum + item.total, 0)).toBeCloseTo(allocatedTotal, 2);
});

test("união municipal preserva histórico e elimina duplicação", () => {
  const sources = municipal.emendas.reduce((map, record) => {
    map[record.origemMunicipal] = (map[record.origemMunicipal] || 0) + 1;
    return map;
  }, {});

  expect(municipal.metadata.totalRegistros).toBe(581);
  expect(municipal.emendas).toHaveLength(581);
  expect(sources).toEqual({ historico_betha: 224, sapl_camara: 357 });
  expect(municipal.metadata.duplicatasLegadoSapl).toBe(13);
  expect(new Set(municipal.emendas.map(municipalKey)).size).toBe(581);
  expect(municipal.emendas.filter((record) => record.origemMunicipal === "historico_betha").every((record) => record.anoEmenda === "2024")).toBeTruthy();
  expect(municipal.emendas.filter((record) => record.origemMunicipal === "sapl_camara").every((record) => Number(record.anoEmenda) >= 2025)).toBeTruthy();
});

test("comprovação financeira não é inferida de agregados", () => {
  const federaisAgregadas = federal.emendas.filter((record) => record.granularidade === "emenda_favorecido_agregado");
  expect(federaisAgregadas.length).toBeGreaterThan(0);
  expect(federaisAgregadas.every((record) => record.identificador_repasse_confirmado !== true)).toBeTruthy();

  const estaduaisOficiais = estadual.emendas.filter((record) => record.classificacaoComprovacao === "confirmado");
  expect(estaduaisOficiais).toHaveLength(estadual.metadata.totalRegistros);
  expect(estaduaisOficiais.every((record) => record.granularidade === "indicacao_estadual_oficial")).toBeTruthy();
  expect(estaduaisOficiais.every((record) => record.identificador_repasse_confirmado !== true)).toBeTruthy();

  const estaduais2026 = estaduaisOficiais.filter((record) => record.anoEmenda === "2026");
  expect(estaduais2026).toHaveLength(31);
  expect(estaduais2026.reduce((sum, record) => sum + Number(record.valorIndicado || 0), 0)).toBeCloseTo(4_606_500, 2);
  expect(estaduais2026.reduce((sum, record) => sum + Number(record.valorPago || 0), 0)).toBe(0);
  expect(estaduais2026.filter((record) => Number(record.valorUtilizado || 0) > 0).every((record) => record.estagioAtual !== "pago")).toBeTruthy();
});

test("transferências especiais usam plano e conta exatos sem duplicar reprocessamento", () => {
  const especiais = federal.emendas.filter((record) => record.granularidade === "emenda_plano_acao_transferegov");
  expect(especiais).toHaveLength(8);
  expect(new Set(especiais.map((record) => record.emenda)).size).toBe(8);
  expect(especiais.reduce((sum, record) => sum + Number(record.valorIndicado || 0), 0)).toBeCloseTo(3_561_727, 2);
  expect(especiais.every((record) => record.documentoBeneficiario === "18240119000105")).toBeTruthy();
  expect(especiais.every((record) => record.planoAcaoId && record.fonteExecucao?.includes("Transferegov"))).toBeTruthy();
  expect(especiais.every((record) => record.valorLiquidado === null)).toBeTruthy();

  const reprocessada = especiais.find((record) => record.emenda === "202527540001");
  expect(reprocessada.planosRelacionados).toHaveLength(2);
  expect(reprocessada.planoAcaoId).toBe(86374);
  expect(reprocessada.impedimentosHistoricos).toHaveLength(1);
  expect(reprocessada.valorIndicado).toBe(247_500);

  const atual = especiais.find((record) => record.emenda === "202627540001");
  expect(atual.dataEmpenho).toBe("2026-06-19");
  expect(atual.dataPagamento).toBe("2026-06-22");
  expect(atual.dataRecurso).toBe("2026-06-23");
  expect(atual.valorRecebido).toBe(1_194_000);
  expect(atual.valorExecutado).toBeNull();
  expect(atual.execucao).not.toContain("08/05/2026");
  expect(atual.objetoTransferegov).toContain("Hospital Bom Pastor");

  const patrimonio2022 = especiais.find((record) => record.emenda === "202214080012");
  expect(patrimonio2022.anoEmenda).toBe("2022");
  expect(patrimonio2022.anoRecurso).toBe("2023");
  expect(patrimonio2022.anosRelacionados).toEqual(["2022", "2023"]);
});

test("valores, CNPJs e estágios publicados permanecem auditáveis", () => {
  const implausible = records.filter((record) => {
    const value = Number(record.valor);
    return !Number.isFinite(value) || value < 0 || value > 1_000_000_000;
  });
  expect(implausible).toEqual([]);

  const invalidUnmarked = municipal.emendas.filter((record) => {
    const cnpj = record.documentoBeneficiario;
    if (!cnpj || validCnpj(cnpj)) return false;
    return record.cnpjStatus !== "invalido";
  });
  expect(invalidUnmarked).toEqual([]);

  const stageViolations = records.filter((record) => {
    const committed = money(record, ["valorEmpenhado", "empenhado"]);
    const settled = money(record, ["valorLiquidado", "liquidado"]);
    const paid = money(record, ["valorPago", "pago"]);
    return (paid !== undefined && settled !== undefined && paid > settled + 0.01)
      || (settled !== undefined && committed !== undefined && settled > committed + 0.01);
  });
  expect(stageViolations).toEqual([]);
});

test("interface carrega a união municipal e mostra N/D para recebimento não comprovado", async ({ page, request }) => {
  for (const asset of [
    "/emendas/",
    "/emendas/app.js",
    "/emendas/data/emendas_municipais_unificadas.js",
    "/emendas/data/emendas_estaduais_normalizadas.js",
    "/emendas/data/emendas_federais.js",
  ]) {
    // Timeout generoso de proposito: emendas_municipais_unificadas.js tem ~3,5 MB
    // e o padrao de 10s estoura em maquina carregada (a suite inteira leva ~7 min).
    // Em 22/07/2026 esse timeout reprovou o teste e, como o gate derruba o ciclo,
    // bloqueou coleta, deploy e os alertas do WhatsApp — sem nenhum dado errado.
    // A verificacao continua a mesma: o asset precisa ser servido via HTTP.
    const response = await request.get(asset, { timeout: 60000 });
    expect(response.ok(), `${asset} deve responder via HTTP`).toBeTruthy();
  }

  await page.goto("/emendas/");
  await expect(page.locator("#federalPorTipo")).toContainText("Valor agregado de emendas");
  await page.selectOption("#typeFilter", "Municipal");
  await expect(page.locator("#resultSummary")).toContainText("581 resultados");

  await page.selectOption("#typeFilter", "Estadual");
  let cards = page.locator(".result-card");
  await expect(cards.first()).toBeVisible();
  let stageTexts = await cards.evaluateAll((nodes) => nodes.map((node) => node.textContent || ""));
  expect(stageTexts.every((text) => /Recebido confirmado\s*N\/D/.test(text))).toBeTruthy();

  await page.selectOption("#typeFilter", "Federal");
  await page.fill("#searchInput", "202627540001");
  cards = page.locator(".result-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Recebido confirmado");
  await expect(cards.first()).toContainText("R$ 1.194.000,00");
  await expect(cards.first()).toContainText("Trilha federal vinculada (Transferegov)");
});
