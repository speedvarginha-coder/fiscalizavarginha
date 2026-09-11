// @ts-check
const { test, expect } = require("@playwright/test");
// As falhas de rede são simuladas nas requisições da página. O service worker
// é testado separadamente no pacote, pois pode responder fora dessas rotas.
test.use({ serviceWorkers: "block" });

test("publicações pesadas aguardam a página pronta e preservam as duas fontes", async ({ page, request }) => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route("**/data/chunks/publicacoes*.json", async route => { await held; await route.continue(); });
  try {
    await page.goto("/atualizacoes.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-fiscaliza-ready", "true", { timeout: 30000 });
    await expect(page.locator("#publicacoesStatus")).toContainText("Carregando");
    expect(await page.evaluate(() => Boolean(window.FISCALIZA_DATA.publicacoes_diario))).toBe(false);
  } finally { release(); }
  const camara = await (await request.get("/data/chunks/publicacoes_estruturadas.json")).json();
  const diario = await (await request.get("/data/chunks/publicacoes_diario.json")).json();
  await expect(page.locator("#publicacoesFeed")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#publicacoesContador")).toHaveText(`${(camara.publicacoes.length + diario.publicacoes.length).toLocaleString("pt-BR")} publicação(ões)`);
});

test("falha de uma fonte de publicações mantém a outra e informa cobertura parcial", async ({ page, request }) => {
  await page.route("**/data/chunks/publicacoes_diario.json", route => route.fulfill({ status: 503, body: "indisponível" }));
  await page.goto("/atualizacoes.html", { waitUntil: "domcontentloaded" });
  const camara = await (await request.get("/data/chunks/publicacoes_estruturadas.json")).json();
  await expect(page.locator("#publicacoesFeed")).toHaveAttribute("aria-busy", "false", { timeout: 30000 });
  await expect(page.locator("#publicacoesStatus")).toContainText("Uma fonte está indisponível");
  await expect(page.locator("#publicacoesContador")).toHaveText(`${camara.publicacoes.length.toLocaleString("pt-BR")} publicação(ões)`);
});

test("Câmara usa contratos completos sem carregar detalhes da frota", async ({ page, request }) => {
  const pedidos = [];
  page.on("request", req => pedidos.push(new URL(req.url()).pathname));
  await page.goto("/camara.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toHaveAttribute("data-fiscaliza-ready", "true", { timeout: 30000 });
  const original = await (await request.get("/data/chunks/prefeitura.json")).json();
  expect(await page.evaluate(() => window.FISCALIZA_DATA.prefeitura.contratos.length)).toBe(original.contratos.length);
  expect(pedidos).toContain("/data/chunks/prefeitura_painel.json");
  expect(pedidos).not.toContain("/data/chunks/prefeitura.json");
});

test("Pessoal permite tentar novamente após indisponibilidade da folha", async ({ page }) => {
  let calls = 0;
  await page.route("**/data/chunks/pessoal.json", route => ++calls === 1
    ? route.fulfill({ status: 503, body: "indisponível" }) : route.continue());
  await page.goto("/pessoal.html", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.locator("#listaPessoal article").first()).toBeVisible({ timeout: 30000 });
});

test("pacote publico serve loader, chunk e modulo sem data.js", async ({ request }) => {
  const index = await request.get("/index.html");
  expect(index.ok()).toBeTruthy();
  const html = await index.text();
  expect(html).toContain('src="data-loader.js');
  expect(html).not.toMatch(/<script[^>]+src=["'][^"']*data\.js/i);

  for (const asset of [
    "/data-loader.js",
    "/data/chunks/home_resumo.json",
    "/data/chunks/resumo.json",
    "/modules/utils.js",
    "/modules/chat-cidadao.js",
  ]) {
    const response = await request.get(asset);
    expect(response.ok(), `${asset} deve responder via HTTP`).toBeTruthy();
    expect((await response.body()).length, `${asset} nao deve estar vazio`).toBeGreaterThan(0);
  }
});

test("home móvel reutiliza cache e não baixa módulos de páginas internas", async ({ page, request }) => {
  const loaderResponse = await request.get("/data-loader.js");
  const loader = await loaderResponse.text();
  expect(loader).not.toMatch(/const\s+\w+\s*=\s*Date\.now\(\)/);
  const versao = loader.match(/const BUILD_VERSION = "([^"]+)"/);
  expect(versao, "o loader deve ter versão de deploy estável").not.toBeNull();
  expect(versao[1]).toMatch(/^\d{8}-[a-z0-9-]+$/i);

  const modulos = [];
  page.on("request", (req) => {
    if (req.url().includes("/modules/")) modulos.push(req.url());
  });

  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.FISCALIZA && typeof window.FISCALIZA.smartAudit === "function");

  expect(modulos.some((url) => url.includes("/modules/utils.js"))).toBe(true);
  expect(modulos.some((url) => url.includes("/modules/home-cidadao.js"))).toBe(true);
  expect(modulos.some((url) => url.includes("/modules/diarias.js"))).toBe(false);
  expect(modulos.some((url) => url.includes("/modules/relatorios.js"))).toBe(false);
  expect(modulos.some((url) => url.includes("/modules/atualizacoes.js"))).toBe(false);
  await expect(page.locator("#loading-overlay")).toHaveCount(0);
  await page.waitForFunction(() => Boolean(window.FISCALIZA_DATA?.home_resumo?.total_externo_atual));
  await expect(page.locator("#hnTotal")).not.toHaveText("—");
});

test("páginas principais não requisitam chunks inexistentes", async ({ page }) => {
  for (const rota of ["/index.html", "/prefeitura.html", "/camara.html", "/relatorios.html"]) {
    const erros = [];
    const observar = (response) => {
      if (response.status() >= 400 && response.url().includes("/data/chunks/")) {
        erros.push(`${response.status()} ${response.url()}`);
      }
    };
    page.on("response", observar);
    await page.goto(rota, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.FISCALIZA_DATA));
    await page.waitForTimeout(400);
    page.off("response", observar);
    expect(erros, `${rota} não deve buscar chunks ausentes`).toEqual([]);
  }
});

test("home publica a LOA 2026 correta e serve o PDF oficial", async ({ request }) => {
  const index = await request.get("/index.html");
  expect(index.ok()).toBeTruthy();
  const html = await index.text();
  expect(html).toContain("LOA 2026 — Lei nº 7.510/2025");
  expect(html).not.toContain("loa-2026-lei-7417-2025.pdf");

  const pdf = await request.get("/docs/loa-2026-lei-7510-2025.pdf");
  expect(pdf.ok()).toBeTruthy();
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).length).toBeGreaterThan(1_000_000);
});

test("conformidade publica origem, arquivo e canal de verificacao dos achados", async ({ page }) => {
  await page.goto("/conformidade.html", { waitUntil: "domcontentloaded" });
  const achados = page.locator("#iftAchados");
  await expect(achados).not.toContainText("Carregando os achados", { timeout: 10_000 });
  await expect(achados).toContainText("Fonte:");
  await expect(achados.locator("code").first()).toBeVisible();
  await expect(achados.locator('a[target="_blank"]').first()).toHaveAttribute("rel", "noopener");
  await expect(achados.locator(".ift-lai-btn").first()).toContainText("Copiar pedido de informação");
  await expect(achados).toContainText("Confiança:");
  await expect(achados).toContainText("Método:");
  await expect(achados).toContainText("Limitação:");
});

test("Prefeitura carrega a base pesada de diárias somente ao abrir a seção", async ({ page, request }) => {
  const requisicoesDiarias = [];
  page.on("request", (req) => {
    if (req.url().includes("/data/chunks/diarias.json")) requisicoesDiarias.push(req.url());
  });

  await page.goto("/prefeitura.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.FISCALIZA_DATA_LOADER && window.FISCALIZA_DATA);
  await page.waitForFunction(() => document.querySelector("#diariasPrefeituraBlock .progressive-data"), null, { timeout: 20_000 });

  expect(requisicoesDiarias).toHaveLength(0);
  expect(await page.evaluate(() => Boolean(window.FISCALIZA_DATA.diarias))).toBe(false);
  await expect(page.locator("#diariasPrefeituraBlock .progressive-data")).toContainText("sob demanda");

  await page.locator('.pref-tab[data-pref-tab="diarias"]').click();
  await page.waitForFunction(() => Boolean(window.FISCALIZA_DATA.diarias));
  await expect(page.locator("#listaDiariasPrefeitura .diaria-card").first()).toBeVisible();

  const fonte = await request.get("/data/chunks/diarias.json");
  const esperado = (await fonte.json()).prefeitura.length;
  const carregado = await page.evaluate(() => window.FISCALIZA_DATA.diarias.prefeitura.length);
  expect(carregado).toBe(esperado);
  expect(requisicoesDiarias).toHaveLength(1);
  expect(await page.locator("body").getAttribute("data-chunk-diarias")).toBe("ready");
});

test("Prefeitura carrega a frota em segundo plano, sem baixar a base completa", async ({ page, request }) => {
  const reqs = [];
  page.on("request", (req) => {
    if (/\/data\/chunks\/prefeitura(_painel|_frota)?\.json/.test(req.url())) reqs.push(req.url());
  });

  await page.goto("/prefeitura.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.FISCALIZA_DATA_LOADER && window.FISCALIZA_DATA);

  // Fase 1 usa o painel enxuto; o prefeitura.json completo (com a frota) nunca desce.
  expect(reqs.some((u) => u.includes("prefeitura_painel.json"))).toBe(true);
  expect(reqs.some((u) => u.includes("/prefeitura.json"))).toBe(false);

  // Fase 2: a frota chega em segundo plano e é colada no painel, sem perda.
  await page.waitForFunction(() => Boolean(window.FISCALIZA_DATA.prefeitura_frota), null, { timeout: 20_000 });
  expect(reqs.some((u) => u.includes("prefeitura_frota.json"))).toBe(true);
  const fonte = await request.get("/data/chunks/prefeitura_frota.json");
  const esperado = (await fonte.json()).frota.length;
  const carregado = await page.evaluate(() => (window.FISCALIZA_DATA.prefeitura.frota || []).length);
  expect(carregado).toBe(esperado);
  expect(carregado).toBeGreaterThan(0);
});

test("carregador progressivo reutiliza a mesma requisição e preserva todos os registros", async ({ page }) => {
  let requisicoes = 0;
  page.on("request", (req) => {
    if (req.url().includes("/data/chunks/diarias.json")) requisicoes += 1;
  });

  await page.goto("/camara.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.FISCALIZA_DATA_LOADER && window.FISCALIZA_DATA);
  const totais = await page.evaluate(async () => {
    const [a, b] = await Promise.all([
      window.FISCALIZA_DATA_LOADER.load("diarias"),
      window.FISCALIZA_DATA_LOADER.load("diarias"),
    ]);
    return [a.camara.length, b.camara.length, window.FISCALIZA_DATA.diarias.camara.length];
  });

  expect(totais[0]).toBeGreaterThan(0);
  expect(totais[0]).toBe(totais[1]);
  expect(totais[1]).toBe(totais[2]);
  expect(requisicoes).toBe(1);
  const primeiroCard = page.locator("#listaDiariasCamara .diaria-card").first();
  await expect(primeiroCard).toHaveCount(1);
  expect(await page.locator("#listaDiariasCamara .diaria-card").count()).toBeGreaterThan(0);
  expect(await page.locator("#diariasCamaraBlock").getAttribute("data-progressive-state")).toBe("ready");
});

test("relatorios publica preco homologado x referencia sem atrasar o primeiro render", async ({ page, request }) => {
  const pedidos = [];
  page.on("request", (req) => {
    if (req.url().includes("/data/chunks/licitacoes_resultados.json")) pedidos.push(req.url());
  });

  await page.goto("/relatorios.html", { waitUntil: "domcontentloaded" });
  await page.locator("#sinaisAtencao .sev").first().waitFor({ timeout: 20_000 });

  // 687 KB: a base entra na fase 2 e os sinais sao refeitos quando ela chega.
  await page.waitForFunction(() => Boolean(window.FISCALIZA_DATA.licitacoes_resultados), null, { timeout: 20_000 });
  expect(pedidos.length, "a base deve ser buscada uma vez").toBe(1);

  const registros = (await (await request.get("/data/chunks/licitacoes_resultados.json")).json()).registros || [];
  const razoes = registros
    .map((r) => {
      const est = Number(r.valor_estimado) || 0;
      const hom = Number(r.valor_homologado_total) || 0;
      return est > 0 && hom > 0 && hom / est > 0.01 ? hom / est : null;
    })
    .filter((x) => x !== null);
  const acimaDaReferencia = razoes.filter((x) => x > 1).length;
  const semDesconto = razoes.filter((x) => x >= 0.97).length;

  await page.waitForFunction(
    () => (document.querySelector("#sinaisAtencao")?.textContent || "").toLowerCase().includes("valor de referência"),
    null,
    { timeout: 20_000 },
  );
  const txt = ((await page.locator("#sinaisAtencao").textContent()) || "").toLowerCase();

  if (razoes.length >= 20 && (semDesconto / razoes.length) * 100 >= 30) {
    expect(txt).toContain("desconto abaixo de 3%");
    // O agregado é sobre a disputa, não sobre um fornecedor: nao pode acusar.
    expect(txt).toContain("não prova combinação");
    expect(txt).toContain("pesquisa de preços");
  }
  if (acimaDaReferencia > 0) {
    expect(txt).toContain("o valor estimado");
    expect(txt).toContain("termo de homologação");
    expect(txt).not.toContain("fraude");
  }
});

test("relatorios cobra o plano anual sem transformar ausencia em zero", async ({ page, request }) => {
  await page.goto("/relatorios.html", { waitUntil: "domcontentloaded" });
  await page.locator("#sinaisAtencao .sev").first().waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => Boolean(window.FISCALIZA_DATA.pca), null, { timeout: 30_000 });

  const pca = await (await request.get("/data/chunks/pca.json")).json();
  const planos = pca.planos || [];
  const ano = Math.min(...(pca.anos_consultados || []));

  // Coerencia da base antes de cobrar a tela: soma dos itens tem que bater com
  // o cabecalho do PNCP, senao o painel publicaria plano parcial como total.
  for (const p of planos.filter((x) => x.status === "ok")) {
    const somaItens = (p.itens || []).reduce((a, i) => a + (Number(i.valor_total) || 0), 0);
    expect(Math.abs(somaItens - p.valor_total_pncp) / p.valor_total_pncp,
      `${p.entidade}/${p.ano}: soma dos itens diverge do cabecalho do PNCP`).toBeLessThan(0.001);
    expect(p.itens.length).toBe(p.itens_qtd_pncp);
  }

  // Item marcado como comparavel sem unidade de fornecimento permitiria
  // comparar tonelada com quilo.
  for (const p of planos) {
    for (const i of p.itens || []) {
      if (i.preco_comparavel) expect(i.unidade_fornecimento, `${p.entidade} item ${i.numero_item}`).toBeTruthy();
    }
  }

  await page.waitForFunction(
    () => (document.querySelector("#sinaisAtencao")?.textContent || "").includes("PNCP"),
    null,
    { timeout: 20_000 },
  );
  const txt = ((await page.locator("#sinaisAtencao").textContent()) || "").toLowerCase();

  const naoPublicaram = planos.filter((p) => p.ano === ano && p.status === "nao_publicado");
  if (naoPublicaram.length) {
    expect(txt).toContain("não publicou o plano de contratações");
    expect(txt).toContain("14.133");
    // ausencia declarada pela fonte nao pode virar acusacao fechada
    expect(txt).toContain("ou publicado sob outro cnpj");
  }

  const semCatalogo = planos.filter(
    (p) => (p.resumo || {}).itens_qtd > 50 && p.resumo.itens_sem_codigo_catalogo === p.resumo.itens_qtd,
  );
  if (semCatalogo.length) {
    expect(txt).toContain("código de catálogo");
    expect(txt).toContain("não indica irregularidade");
  }
});

test("Monitoramento mostra situação e idade das fontes em linguagem simples", async ({ page }) => {
  await page.goto("/monitoramento.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#sources tr").length > 0, null, { timeout: 15_000 });
  const linhas = await page.locator("#sources tr").count();
  expect(linhas).toBeGreaterThanOrEqual(13);
  const texto = await page.locator("#sources").innerText();
  // Situação traduzida, não o código cru em inglês.
  expect(texto).toMatch(/Atualizada|Parcial|Base anterior preservada|Conferência manual/);
  // Idade em linguagem comum, não só data ISO.
  expect(texto).toMatch(/hoje|há \d+ dias?|sem data de coleta/);
});

test("busca global abre pelo menu e roteia em página interna", async ({ page }) => {
  await page.goto("/prefeitura.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.FISCALIZA && typeof window.FISCALIZA.smartAudit === "function");
  await page.waitForFunction(() => Boolean((window.FISCALIZA_DATA || {}).prefeitura));
  await page.locator(".busca-global__fab").first().click();
  const overlay = page.locator(".busca-global");
  await expect(overlay).toBeVisible();
  await overlay.locator("#buscaGlobal").fill("Vila Floresta");
  await overlay.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/prefeitura\.html\?tab=asfalto&q=Vila%20Floresta/);
});

test("busca da aba Asfalto mantem o q na URL (nao vira so tab+ano)", async ({ page }) => {
  await page.goto("/prefeitura.html?tab=asfalto&q=Vila%20Floresta", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.getAttribute("data-fiscaliza-ready") === "true", null, { timeout: 45_000 });
  await expect(page.locator("#filtroBuscaAsfalto")).toHaveValue("Vila Floresta");
  expect(new URL(page.url()).searchParams.get("q")).toBe("Vila Floresta");
});

test("blocos mostram a proveniência do dado (fonte, situação, data e link)", async ({ page }) => {
  await page.goto("/prefeitura.html?tab=asfalto", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.getAttribute("data-fiscaliza-ready") === "true", null, { timeout: 45_000 });
  const prov = page.locator("#asfaltoBlock .record-provenance").first();
  await expect(prov).toContainText("Proveniência:");
  await expect(prov).toContainText("Betha/Portal da Prefeitura");
  await expect(prov).toContainText(/atualizada|parcial|base anterior preservada|verificação manual|defasada/);
  await expect(prov.locator("a", { hasText: "abrir origem" })).toBeVisible();

  await page.goto("/camara.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.getAttribute("data-fiscaliza-ready") === "true", null, { timeout: 45_000 });
  await expect(page.locator(".record-provenance").first()).toContainText("Proveniência:");

  await page.goto("/fundacao.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.getAttribute("data-fiscaliza-ready") === "true", null, { timeout: 45_000 });
  await expect(page.locator(".record-provenance").first()).toContainText("Fundação Cultural");
});

test("Sobre traz o dicionário de campos com a origem de cada um", async ({ page }) => {
  await page.goto("/sobre.html", { waitUntil: "domcontentloaded" });
  const dic = page.locator("#dicionarioCampos");
  await expect(dic).toBeVisible();
  await expect(dic).toContainText("De onde vem");
  await expect(dic).toContainText("valor contratado");
  await expect(dic).toContainText("Não é o valor pago");
  await expect(dic).toContainText("Ausente no retorno dos contratos");
});

test("Obras por bairro mostra valores corretos e detalha as obras", async ({ page }) => {
  await page.goto("/prefeitura.html?tab=asfalto", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.getAttribute("data-fiscaliza-ready") === "true", null, { timeout: 45_000 });
  const painel = page.locator("#obrasPorBairro");
  await expect(painel).toBeVisible();
  await expect(painel).toContainText("Obras por bairro");
  await expect(painel).toContainText("não publica o orçamento inteiro por bairro");
  const primeira = await painel.locator(".obras-bairro__row").first().innerText();
  expect(primeira).toMatch(/Centro/);
  expect(primeira).toMatch(/R\$/);
  // 130 obras com 1 sem bairro → aparece o aviso de cobertura
  await expect(painel).toContainText(/1 sem bairro informado/);
  // Clicar num bairro revela as obras dele
  await painel.locator(".obras-bairro__row").filter({ hasText: "Vila Floresta" }).click();
  const detalhe = page.locator("#obrasBairroDetalhe");
  await expect(detalhe).toBeVisible();
  await expect(detalhe).toContainText("Vila Floresta");
  expect(await detalhe.locator(".obras-bairro__obra").count()).toBeGreaterThan(0);
});

test("Pessoal e Diário também exibem a proveniência do dado", async ({ page }) => {
  await page.goto("/pessoal.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.getAttribute("data-fiscaliza-ready") === "true", null, { timeout: 45_000 });
  await expect(page.locator("#pessoalFonteNota + .record-provenance")).toContainText("Proveniência:");
  await expect(page.locator("#pessoalFonteNota + .record-provenance")).toContainText("folha de pagamento");

  await page.goto("/prefeitura.html?tab=fontes", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.getAttribute("data-fiscaliza-ready") === "true", null, { timeout: 45_000 });
  await expect(page.locator("#diarioLista + .record-provenance")).toContainText("Diário Oficial");
});
