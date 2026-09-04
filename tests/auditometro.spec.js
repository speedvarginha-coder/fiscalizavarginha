const { test, expect } = require("@playwright/test");
const reference = require("../painel-cidadao/data/referencias/pntp-2025.json");
test.use({ serviceWorkers: "block" });

test("PNTP reproduz a fonte, filtra itens únicos e mantém evidências", async ({ page }) => {
  const failures = [];
  page.on("pageerror", error => failures.push(error.message));
  await page.goto("/index.html");
  for (const [key, selector] of [["prefeitura", "#scorePrefeitura"], ["camara", "#scoreCamara"]]) {
    const entity = reference.orgaos[key];
    expect(entity.ibge).toBe("3170701");
    expect([entity.autoavaliacao, entity.validada, entity.revisada, entity.certificavel]).toEqual([true, false, false, false]);
    const card = page.locator(selector);
    await expect(card.locator(".pntp-card__score")).toHaveText(entity.indice.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) + "%");
    await expect(card).toContainText(entity.essenciais.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) + "%");
    await card.getByRole("button", { name: "Ver pendências", exact: true }).click();
    await expect(page.locator("#pntpResultsStatus")).toContainText(`${entity.itens_pendentes} itens de verificação`);
    await page.selectOption("#pntpFilter", "atendidos");
    await expect(page.locator("#pntpCriteria li")).toHaveCount(entity.itens_atendidos);
    const criterion = page.locator(".pntp-criterion").filter({ has: page.locator("a") }).first();
    await criterion.locator("summary").click();
    await expect(criterion.locator("a").first()).toHaveAttribute("href", /^https?:\/\//);
    await page.fill("#pntpSearch", "termo-sem-resultado-123");
    await expect(page.locator("#pntpResultsStatus")).toContainText("Nenhum item encontrado");
    await page.getByRole("button", { name: "Fechar critérios" }).click();
    await expect(card.getByRole("button", { name: "Ver pendências", exact: true })).toBeFocused();
  }
  await expect(page.locator(".pntp__notice")).toContainText("sem validação registrada");
  expect(failures).toEqual([]);
});

test("falha de referência permite nova tentativa sem zerar notas", async ({ page }) => {
  let requests = 0;
  await page.route("**/data/referencias/pntp-2025.json", route => {
    requests++;
    return requests === 1 ? route.fulfill({ status: 503, body: "indisponível" }) : route.continue();
  });
  await page.goto("/index.html");
  await page.locator('[data-pntp-orgao="prefeitura"][data-pntp-filtro="pendentes"]').click();
  await expect(page.locator("#pntpResultsStatus")).toContainText("Não foi possível carregar");
  await expect(page.locator("#scorePrefeitura .pntp-card__score")).toHaveText("81,80%");
  await page.getByRole("button", { name: "Tentar carregar novamente" }).click();
  await expect(page.locator("#pntpCriteria li")).toHaveCount(77);
});

test("indicadores locais tratam vazio, erros e CNPJs sem sugerir certificação", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("body")).toHaveAttribute("data-fiscaliza-ready", "true", { timeout: 30000 });
  await expect(page.locator("#pntpLocalPref")).toContainText("contratos têm descrição", { timeout: 30000 });
  await page.evaluate(() => {
    window.FISCALIZA_DATA.prefeitura = { contratos: [] };
    window.FISCALIZA_DATA.emendas = [];
    window.dispatchEvent(new CustomEvent("fiscaliza:chunk", { detail: { key: "prefeitura" } }));
  });
  await expect(page.locator("#pntpLocalPref")).toContainText("Nenhuma porcentagem calculada");
  await expect(page.locator("#pntpLocalCam")).not.toContainText("100%");
  await page.evaluate(() => {
    window.FISCALIZA_DATA.emendas = [
      { cnpj: "18.240.119/0001-05" }, { cnpj: "18.240.119/0001-06" },
      { cnpj: "11.111.111/1111-11" }, { cnpj: "" }, { cnpj: "18.240.119/****-**" }
    ];
    window.dispatchEvent(new CustomEvent("fiscaliza:chunk", { detail: { key: "emendas" } }));
  });
  await expect(page.locator("#pntpLocalCam")).toContainText("20%");
  await expect(page.locator("#pntpLocalCam")).toContainText("2 inconsistentes · 1 ausentes · 1 mascarados");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("fiscaliza:chunk:error", { detail: { key: "prefeitura" } })));
  await expect(page.locator("#pntpLocalPref")).toContainText("Falha ao carregar");
  await expect(page.locator("#scoreCamara .pntp-card__score")).toHaveText("63,28%");
});

test("Auditômetro cabe no celular e critérios abrem pelo teclado", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/index.html#auditometro");
  const button = page.locator('[data-pntp-orgao="camara"][data-pntp-filtro="pendentes"]');
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#pntpCriteria li")).toHaveCount(112);
  await expect(page.locator("#pntpDetailsTitle")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "Fechar critérios" }).click();
  await page.locator("#pntpPanel").screenshot({ path: "tmp/auditometro-mobile.png" });
});
