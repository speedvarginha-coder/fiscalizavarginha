// @ts-check
/**
 * Smoke tests — Fiscaliza Varginha
 *
 * Objetivo: garantir que cada página HTML abre, executa app.js sem erro
 * crítico no console, e renderiza pelo menos um bloco principal.
 *
 * Estes testes NÃO substituem QA manual. Pegam regressões básicas:
 *   - JS quebrado (ReferenceError, TypeError)
 *   - Strings hard-coded vazias
 *   - data.js não carregando
 *   - Blocos principais desaparecendo
 */
const { test, expect } = require("@playwright/test");
const path = require("path");

const PAINEL = path.resolve(__dirname, "..", "painel-cidadao");
const fileUrl = (page) => "file:///" + path.join(PAINEL, page).replace(/\\/g, "/");

/** Coleta erros do console — ignora limitações de file:// (não-bugs do app). */
const BENIGNOS = [
  /favicon/,
  /net::ERR_FILE_NOT_FOUND.*\.json/,
  /ServiceWorker.*protocol.*not supported/i,  // SW só funciona em http(s)
  /Failed to register a ServiceWorker.*null/i,
  /URL protocol of the current origin/i,
];
function setupConsoleListener(page) {
  const erros = [];
  const isBenign = (txt) => BENIGNOS.some((r) => r.test(txt));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const txt = msg.text();
      if (isBenign(txt)) return;
      erros.push(txt);
    }
  });
  page.on("pageerror", (err) => {
    if (isBenign(err.message)) return;
    erros.push("UNCAUGHT: " + err.message);
  });
  return erros;
}

const PAGINAS = [
  { arquivo: "index.html",      titulo: /Fiscaliza Varginha/,           bloco: "footer" },
  { arquivo: "prefeitura.html", titulo: /Prefeitura/,              bloco: "#placarPrefeitura" },
  { arquivo: "camara.html",     titulo: /C.mara/,                  bloco: "#placarCamara" },
  { arquivo: "relatorios.html", titulo: /Relat.rios/,              bloco: "#prioridadesFiscalizacao" },
  { arquivo: "pessoal.html",    titulo: /Pessoal/,                 bloco: "#listaPessoal" },
  { arquivo: "sobre.html",      titulo: /Sobre/,                   bloco: "#tabelaGlossario" },
  { arquivo: "cobrar.html",     titulo: /Como cobrar/,             bloco: ".cobrar-block" },
  { arquivo: "marcadores.html", titulo: /Marcadores/,              bloco: "#marcadoresArea" },
  { arquivo: "atualizacoes.html", titulo: /Atualiza..es/,           bloco: "#atualizacoesFeed" },
];

for (const p of PAGINAS) {
  test.describe(`Página: ${p.arquivo}`, () => {
    test("abre sem erro fatal no console", async ({ page }) => {
      const erros = setupConsoleListener(page);
      await page.goto(fileUrl(p.arquivo), { waitUntil: "domcontentloaded" });
      // Espera app.js terminar de inicializar (overlay de loading some)
      await page.waitForFunction(
        () => !document.getElementById("loading-overlay") ||
              document.getElementById("loading-overlay").classList.contains("fadeout"),
        { timeout: 15_000 }
      ).catch(() => { /* algumas páginas não têm overlay */ });
      // Pausa breve para qualquer erro tardio aparecer
      await page.waitForTimeout(500);
      expect(erros, "Erros no console:\n" + erros.join("\n")).toEqual([]);
    });

    test("tem o título correto", async ({ page }) => {
      await page.goto(fileUrl(p.arquivo));
      await expect(page).toHaveTitle(p.titulo);
    });

    test(`bloco principal aparece (${p.bloco})`, async ({ page }) => {
      await page.goto(fileUrl(p.arquivo), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500); // dá tempo do app.js renderizar
      const el = page.locator(p.bloco).first();
      await expect(el, `Bloco ${p.bloco} não foi encontrado`).toBeAttached();
    });
  });
}

test.describe("Navegação", () => {
  test("nav contém todos os links principais", async ({ page }) => {
    await page.goto(fileUrl("index.html"));
    const links = [
      "index.html", "prefeitura.html", "camara.html",
      "relatorios.html", "pessoal.html",
      "atualizacoes.html", "sobre.html", "cobrar.html",
    ];
    for (const href of links) {
      await expect(page.locator(`nav a[href="${href}"]`).first()).toBeAttached();
    }
  });
});

test.describe("Legenda de leitura dos dados", () => {
  test("legenda fixa explica fato, cruzamento, inferência e pendência", async ({ page }) => {
    await page.goto(fileUrl("index.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const legend = page.locator("#dataReadingLegend");
    await expect(legend).toBeAttached();
    await expect(legend.locator(".data-legend__toggle")).toHaveAttribute("aria-expanded", "false");
    await legend.locator(".data-legend__toggle").click();
    await expect(legend.locator(".data-legend__toggle")).toHaveAttribute("aria-expanded", "true");
    await expect(legend).toContainText("Fato oficial");
    await expect(legend).toContainText("Cruzamento");
    await expect(legend).toContainText("Inferência");
    await expect(legend).toContainText("Pendência");
    await expect(legend).toContainText("Atenção");
  });
});

test.describe("Avisos de qualidade dos dados", () => {
  test("paginas publicas exibem limitacoes quando a auditoria aponta alerta", async ({ page }) => {
    await page.goto(fileUrl("cobrar.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const aviso = page.locator(".data-health-strip").first();
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText(/limites dos dados|alerta critico/i);
    await expect(aviso).toContainText(/fonte oficial/i);
    await expect(aviso.locator('a[href="sobre.html#auditoriaDados"]')).toContainText(/auditoria completa/i);
  });
});

test.describe("Mapa cidadao do dinheiro", () => {
  test("home usa central de fiscalizacao compacta", async ({ page }) => {
    await page.goto(fileUrl("index.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const layout = await page.evaluate(() => {
      const heights = (sel) => Array.from(document.querySelectorAll(sel)).map((el) =>
        Math.round(el.getBoundingClientRect().height)
      );
      const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect();
      return {
        sideExists: Boolean(document.querySelector(".home-ops__side")),
        headHeight: Math.round(rect(".home-ops__head")?.height || 0),
        statMax: Math.max(...heights(".home-stat")),
        priorityMax: Math.max(...heights(".priority-row")),
      };
    });
    expect(layout.sideExists).toBeTruthy();
    expect(layout.headHeight).toBeLessThan(340);
    expect(layout.statMax).toBeLessThan(160);
    expect(layout.priorityMax).toBeLessThan(140);
  });

  test("home mostra guia para quem não sabe por onde começar", async ({ page }) => {
    await page.goto(fileUrl("index.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const guia = page.locator("#homeStartGuide");
    await expect(guia).toContainText("Não sei por onde começar");
    await expect(guia).toContainText("Obras e buracos");
    await expect(guia).toContainText("Você vai ver");
    await guia.locator('[data-start-key="diario"]').click();
    await expect(guia).toContainText("Quero ver o que saiu no Diário Oficial");
    const link = guia.locator('a', { hasText: "Abrir Diário Oficial" });
    await expect(link).toHaveAttribute("href", "atualizacoes.html?tab=diario");
  });

  test("home mostra destinos do dinheiro e abre explicacao", async ({ page }) => {
    await page.goto(fileUrl("index.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await expect(page.locator("#homeMoneyMap .money-topic").first()).toBeAttached();
    await expect(page.locator("#homeMoneyMap")).toContainText("Para onde foi o dinheiro");
    await page.locator("#homeMoneyMap .money-topic__actions button").first().click();
    const modal = page.locator("#modalFiscaliza");
    await expect(modal).toBeAttached();
    await expect(modal.locator("text=EXPLICAÇÃO CIDADÃ")).toBeVisible();
    await expect(modal.locator("text=O que perguntar")).toBeVisible();
  });
});

test.describe("Tendencia cidada do dinheiro", () => {
  test("home compara anos e abre explicacao", async ({ page }) => {
    await page.goto(fileUrl("index.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await expect(page.locator("#homeTrendWatch .trend-card").first()).toBeAttached();
    await expect(page.locator("#homeTrendWatch")).toContainText("Está melhorando ou piorando");
    await page.locator("#homeTrendWatch .money-topic__actions button").first().click();
    const modal = page.locator("#modalFiscaliza");
    await expect(modal).toBeAttached();
    await expect(modal.locator("text=TENDÊNCIA CIDADÃ")).toBeVisible();
    await expect(modal.locator("text=Confiança do dado")).toBeVisible();
  });
});

test.describe("Auditor inteligente", () => {
  test("home sugere caminhos de busca enquanto o cidadão digita", async ({ page }) => {
    await page.goto(fileUrl("index.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.locator("#buscaHome").fill("as");
    const sugestoes = page.locator("#homeSmartSuggest");
    await expect(sugestoes).toContainText("Asfalto e buracos");
    await expect(sugestoes).toContainText("Ver gastos com pavimentação");
    await page.locator('#homeSmartSuggest [data-smart-pick="asfalto"]').click();
    await expect(sugestoes).toContainText("Resultado guiado");
    await expect(sugestoes).toContainText("Você vai abrir");
    await expect(sugestoes).toContainText("Pergunta pronta");
    await page.locator('#homeSmartSuggest [data-smart-q="asfalto"]').click();
    await expect(page).toHaveURL(/prefeitura\.html\?tab=asfalto&q=asfalto/);
  });
});

test.describe("Como cobrar", () => {
  test("mostra caminhos guiados para o cidadao comum", async ({ page }) => {
    await page.goto(fileUrl("cobrar.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const guia = page.locator(".cobrar-quick");
    await expect(guia).toContainText("O que você quer entender agora?");
    await expect(guia).toContainText("Quero fiscalizar asfalto e buracos");
    await expect(guia).toContainText("Quero copiar um pedido LAI");
    await expect(page.locator(".cobrar-kpis")).toContainText("20 dias");
  });

  test("fila de cobranca renderiza fornecedores priorizados", async ({ page }) => {
    await page.goto(fileUrl("cobrar.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await expect(page.locator("#filaCobrancaLista .risk-queue-card").first()).toBeAttached();
    await expect(page.locator("#filaCobrancaStats")).toContainText(/vermelho|amarelo|fornecedores/i);
    await expect(page.locator("#filaCobrancaLista")).toContainText("Pendências oficiais");
    await expect(page.locator("#filaCobrancaLista")).toContainText("CEIS/CNEP");
    await expect(page.locator("#filaCobrancaLista")).toContainText("PNCP / origem");
    await page.locator("#filaCobrancaLista [data-fila-status]").first().selectOption("aguardando");
    await expect(page.locator("#filaCobrancaLista")).toContainText("Atualizado em");
    await page.locator("#filaCobrancaRisco").selectOption("red");
    await expect(page.locator("#filaCobrancaLista")).toContainText(/Vermelho|Nenhum item/);
  });

  test("fila de cobranca explica que frota e veiculo individual, nao quantidade", async ({ page }) => {
    await page.goto(fileUrl("cobrar.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await page.locator("#filaCobrancaTipo").selectOption("frota");
    const lista = page.locator("#filaCobrancaLista");
    await expect(lista.locator(".risk-queue-card").first()).toBeAttached();
    await expect(lista).toContainText("Prioridade");
    await expect(lista).toContainText(/não é quantidade|nao e quantidade/i);
    await expect(lista).toContainText(/Este card representa 1 veículo específico|Este card representa 1 veiculo especifico/i);
    await expect(lista).toContainText(/Veículos na base|Veiculos na base/i);
    await expect(lista).toContainText(/O que o cidadão pode pedir|O que o cidadao pode pedir/i);
    await expect(lista).toContainText(/diário de bordo|diario de bordo|odômetro|odometro/i);
  });
});

test.describe("Filtros básicos", () => {
  test("Prefeitura — filtro de busca aceita texto", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    // Vai para aba contratos
    await page.locator('[data-pref-tab="contratos"]').first().click();
    const busca = page.locator("#filtroContrato");
    await expect(busca).toBeAttached();
    await busca.fill("teste");
    await expect(busca).toHaveValue("teste");
  });

  test("Prefeitura — busca por número abre detalhes e fonte", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.locator('[data-pref-tab="contratos"]').first().click();
    const busca = page.locator("#filtroContrato");
    await busca.fill("2/2026");
    await expect(busca).toHaveValue("2/2026");
    await expect(page.locator("#contratos .contrato").first()).toBeAttached();
    await page.locator("#contratos .btn-dossie", { hasText: "Ver detalhes e fonte" }).first().click();
    const modal = page.locator("#modalFiscaliza");
    await expect(modal).toBeAttached();
    await expect(modal).toContainText(/CONFER.*NCIA DE PROCED.*NCIA/i);
    await expect(modal.locator("text=Entender este dado")).toBeVisible();
    await expect(modal.locator("text=Checklist cidadão")).toBeVisible();
    const primeiroCheck = modal.locator(".citizen-checklist input").first();
    await primeiroCheck.check();
    await expect(primeiroCheck).toBeChecked();
    await expect(modal.locator("text=Abrir tabela Betha")).toBeVisible();
    await expect(modal.locator("text=Buscar no PNCP")).toBeVisible();
  });

  test("Prefeitura — maiores registros da visão geral abrem contrato", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const row = page.locator("#gastosPalavraChave .keyword-row--button").first();
    await expect(row).toBeVisible();
    await expect(row.locator("text=Ver contrato")).toBeVisible();
    await row.click();
    const modal = page.locator("#modalFiscaliza");
    await expect(modal).toBeAttached();
    await expect(modal).toContainText(/CONFER.*NCIA DE PROCED.*NCIA/i);
  });

  test("Prefeitura — filtro de ano de contratos refina a lista", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.locator('[data-pref-tab="contratos"]').first().click();
    const select = page.locator("#filtroAnoContrato");
    await expect(select).toBeAttached();
    await select.selectOption("2025");
    await page.waitForTimeout(500);
    const count = await page.locator("#contratosContador").innerText();
    expect(count).toContain("contratos");
  });

  test("Prefeitura — filtro de ano de licitação e busca funcionam", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.locator('.pref-tab[data-pref-tab="licitacoes"]').first().click();
    const select = page.locator("#filtroAnoLicitacao");
    await expect(select).toBeVisible();
    await select.selectOption("2026");
    await page.waitForTimeout(500);
    const count = await page.locator("#licitacoesContador").innerText();
    expect(count).toContain("licitações");
  });

  test("Pessoal — ranking de comissionados explica e exibe período", async ({ page }) => {
    await page.goto(fileUrl("pessoal.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const ranking = page.locator("#rankingComissionados");
    await expect(ranking).toBeAttached();
    await expect(ranking.locator("article").first()).toBeAttached();
    const period = page.locator("#rankingPeriodoInfo");
    await expect(period).toBeAttached();
    await expect(period).toContainText(/Prefeitura|Câmara/i);
    const lead = page.locator(".block__lead").filter({ hasText: "Quem são os comissionados?" });
    await expect(lead).toContainText("Quem são os comissionados?");
    await expect(lead).toContainText("Salário Bruto Mensal");
  });

  test("Câmara — filtro de emendas aceita texto", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.locator('.csec-btn[data-go="emendas"]').click();
    const busca = page.locator("#filtroEm");
    await expect(busca).toBeAttached();
    await busca.fill("teste");
    await expect(busca).toHaveValue("teste");
  });

  test("Câmara — chip de categoria abre popup de emendas com fonte SAPL", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.locator('.csec-btn[data-go="emendas"]').click();
    const chip = page.locator("#catChipsCamara .cat-chip:not(.cat-chip--clear)").first();
    await expect(chip).toBeVisible();
    await chip.click();
    const modal = page.locator("#modalFiscaliza");
    await expect(modal).toBeAttached();
    await expect(modal).toContainText(/emendas/i);
    await expect(modal.getByRole("link", { name: /Ver no SAPL/ }).first()).toBeVisible();
  });

  test("Camara - busca por cafe nao relaciona emendas como despesa", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.locator("#categoriaCamaraSelect").selectOption("Cafe");
    await page.waitForTimeout(300);
    const bloco = page.locator("#gastosPalavraChaveCamara");
    await expect(bloco).toContainText(/falsos positivos|Nenhum registro|registros encontrados/i);
    await expect(bloco.locator(".keyword-audit__grid")).not.toContainText("Emenda impositiva");
  });

  test("Selo de confiança do dado aparece em blocos críticos", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await expect(page.locator("#gastosPalavraChaveCamara")).toContainText("Selo de confiança do dado");
    await expect(page.locator("#remuneracaoVereadores")).toContainText("Selo de confiança do dado");
    await expect(page.locator("#topFornecedoresCamara")).toContainText("Selo de confiança do dado");
    await expect(page.locator(".diaria-card").first()).toContainText("Selo de confiança do dado");
  });

  test("Glossário contextual marca termos técnicos renderizados", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const termos = page.locator(".glossario-termo[data-explica]");
    await expect(termos.first()).toBeAttached();
    const achouTermoTecnico = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".glossario-termo[data-explica]"))
        .some((el) => /di[aá]ria|empenho|liquida|dispensa|modalidade/i.test(el.textContent || ""))
    );
    expect(achouTermoTecnico).toBeTruthy();
  });

  test("Câmara — top fornecedor explica busca de contrato", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const btn = page.locator("#topFornecedoresCamara .forn-row__btn--filtro").first();
    await expect(btn).toBeAttached({ timeout: 15_000 });
    await btn.click();
    await expect(page.locator("#contratosCamaraAviso")).toBeVisible();
    await expect(page.locator("#contratosCamaraAviso")).toContainText(/contrato vigente|Nenhum contrato vigente/);
  });

  test("Câmara — top fornecedor abre dossie consolidado", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const btn = page.locator("#topFornecedoresCamara .forn-row__btn--dossie").first();
    await expect(btn).toBeAttached({ timeout: 15_000 });
    await btn.click();
    const modal = page.locator("#modalFiscaliza");
    await expect(modal).toBeAttached();
    await expect(modal.locator("text=DOSSIÊ DO FORNECEDOR")).toBeVisible();
    await expect(modal.locator("text=Pergunta LAI pronta")).toBeVisible();
    await expect(modal.locator("text=Abrir contratos Betha")).toBeVisible();
  });
});

test.describe("Placar do dinheiro", () => {
  test("Prefeitura mostra 4 cards no placar", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const cards = page.locator("#placarPrefeitura .placar-card");
    await expect(cards.first()).toBeAttached({ timeout: 15_000 });
    await expect(cards).toHaveCount(4);
  });

  test("Prefeitura mostra recorte de asfalto, tapa-buraco e custo unitário", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.locator('.pref-tab[data-pref-tab="asfalto"]').first().click();
    const painel = page.locator("#asfaltoPainel");
    await expect(painel).toContainText(/Recorte vi.rio|Asfalto/i);
    await expect(painel).toContainText(/custo m.dio por m.|Sem m./i);
    await expect(painel).toContainText(/Fila de cobran.a|Faltam dados para auditar/i);
    await expect(painel).toContainText(/Rua\/bairro|Metragem\/quantidade|Fiscal respons.vel/i);
    await expect(painel).toContainText(/Data:/);
    await expect(painel).toContainText(/obra\(s\) oficiais Betha|consulta Betha 83026|Obra p.blica Betha/i);
    await expect(painel).toContainText(/Situa..o:|.ltima medi..o|Respons.vel:/i);
    await expect(painel.locator(".asfalto-card").first()).toBeAttached();
    await expect(painel).toContainText(/Copiar pergunta LAI|Abrir Betha/);
  });

  test("Prefeitura mostra frota municipal com gastos e fonte Betha", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.locator('.pref-tab[data-pref-tab="frota"]').first().click();
    const painel = page.locator("#frotaBlock");
    await expect(painel).toContainText(/Frota municipal/i);
    await expect(painel).toContainText(/gastos vinculados auditáveis|gastos vinculados/i);
    await expect(painel).toContainText(/combustível|combustivel|manutenção|manutencao/i);
    await expect(painel.locator(".frota-card").first()).toBeAttached();
    await expect(painel).toContainText(/Centro de custo|Copiar pergunta LAI|Abrir Betha/i);
  });

  test("Câmara mostra 4 cards no placar", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const cards = page.locator("#placarCamara .placar-card");
    await expect(cards).toHaveCount(4);
  });

  test("Câmara mostra indice de relevancia logo apos a apresentacao", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const layout = await page.evaluate(() => {
      const header = document.querySelector(".bigheader");
      const spotlight = document.querySelector(".camara-index-spotlight");
      const indice = document.querySelector("#indiceRelevancia");
      const placar = document.querySelector("#placarCamara");
      return {
        hasSpotlight: Boolean(spotlight),
        indiceInsideSpotlight: Boolean(indice?.closest(".camara-index-spotlight")),
        indiceDataSection: indice?.closest("[data-csec]")?.getAttribute("data-csec") || "",
        afterHeader: Boolean(header && spotlight && (header.compareDocumentPosition(spotlight) & Node.DOCUMENT_POSITION_FOLLOWING)),
        beforePlacar: Boolean(spotlight && placar && (spotlight.compareDocumentPosition(placar) & Node.DOCUMENT_POSITION_FOLLOWING)),
      };
    });
    expect(layout.hasSpotlight).toBeTruthy();
    expect(layout.indiceInsideSpotlight).toBeTruthy();
    expect(layout.indiceDataSection).toBe("");
    expect(layout.afterHeader).toBeTruthy();
    expect(layout.beforePlacar).toBeTruthy();
  });

  test("Câmara mostra índice de relevância auditável", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await expect(page.locator("#indiceRelevancia .indice-card").first()).toBeAttached();
    await expect(page.locator("#indiceRelevancia")).toContainText("confianca/cobertura");
    await expect(page.locator('#indiceRelevancia [data-indice-perfil="fiscalizador"]')).toBeAttached();
  });

  test("Câmara - clicar na nota abre modal explicando os pesos (a conta bate)", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.locator('.csec-btn[data-go="vereadores"]').click();
    const card = page.locator("#indiceRelevancia .indice-card").first();
    const nome = (await card.locator("h4").innerText()).trim();
    const scoreBtn = card.locator(".indice-score-open");
    const score = (await scoreBtn.locator("strong").innerText()).trim();
    await scoreBtn.click();
    const nm = page.locator("#modalFiscaliza .nota-modal");
    await expect(nm).toBeVisible();
    await expect(nm.locator(".nota-modal__nome")).toContainText(nome);
    // a nota grande do modal == a nota do card (a conta dos pesos fecha no mesmo valor)
    await expect(nm.locator(".nota-modal__big strong").first()).toHaveText(score);
    await expect(nm).toContainText("Como cada dimensao foi medida");
    await expect(nm).toContainText("= Nota de Atividade");
    await expect(nm).toContainText("pesam zero");
    await page.locator("#modalFiscaliza .modal__close").click();
    await expect(page.locator("#modalFiscaliza")).toBeHidden();
  });

  test("Câmara mostra remuneração dos vereadores com fonte", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.locator('.csec-btn[data-go="vereadores"]').click();
    await expect(page.locator("#remuneracaoVereadores")).toContainText("Subsidio bruto mensal");
    await expect(page.locator("#remuneracaoVereadores")).toContainText("R$ 10.384,06");
    await expect(page.locator("#remuneracaoVereadores")).toContainText("Folha nominal localizada");
    await expect(page.locator("#remuneracaoVereadores .salary-payroll__row").nth(1)).toBeAttached();
    await expect(page.locator("#remuneracaoVereadores a", { hasText: "Ver lei" })).toBeAttached();
    await page.locator("#remuneracaoVereadores .salary-payroll__row button").first().click();
    await expect(page.locator("#modalFiscaliza")).toContainText("FOLHA NOMINAL");
    await page.locator("#modalFiscaliza .modal__close").click();
    await page.locator("#remuneracaoVereadores button", { hasText: "Entender" }).click();
    const modal = page.locator("#modalFiscaliza");
    await expect(modal).toBeAttached();
    await expect(modal.locator("text=REMUNERACAO PARLAMENTAR")).toBeVisible();
    await expect(modal.locator("text=O que pedir via LAI")).toBeVisible();
  });
});

test.describe("Atualizações diárias (feed)", () => {
  test("Feed renderiza contratos reais coletados do Betha", async ({ page }) => {
    await page.goto(fileUrl("atualizacoes.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const cards = page.locator("#atualizacoesFeed .tline-item");
    // Espera pelo menos 1 ato (contratos reais de Varginha vindos dos dados Betha)
    await expect(cards.first()).toBeAttached();
  });

  test("Stats no topo mostram 4 cards", async ({ page }) => {
    await page.goto(fileUrl("atualizacoes.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const stats = page.locator("#atualizacoesStats .placar-card");
    await expect(stats).toHaveCount(4);
  });

  test("Mostra resumo do que mudou desde a última atualização", async ({ page }) => {
    await page.goto(fileUrl("atualizacoes.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const digest = page.locator("#mudancasRecentes");
    await expect(digest).toBeAttached();
    await expect(digest).toContainText(/O que mudou desde a .ltima atualiza..o/);
    await expect(digest).toContainText(/COMPARA..O REAL DE COLETAS|Recorte autom.tico/);
    await expect(digest).toContainText(/mudan.as detectadas|atos no recorte/);
    await expect(digest).toContainText(/Principais mudan.as detectadas|Prioridade cidad./);
    await expect(digest.locator(".change-digest__item").first()).toBeAttached();
  });

  test("Aba Diário Oficial mostra edições resumidas da fonte oficial", async ({ page }) => {
    await page.goto(fileUrl("atualizacoes.html") + "?tab=diario", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await expect(page.locator("#atualizacoesTabs .update-tab").filter({ hasText: /Di.rio Oficial/ })).toHaveClass(/is-active/);
    await expect(page.locator("#mudancasRecentes")).toContainText(/O que mudou no Di.rio Oficial/);
    await expect(page.locator("#mudancasRecentes")).toContainText(/Abrir PDF da edi..o/);
    await expect(page.locator("#atualizacoesFeed .diario-oficial-card").first()).toBeAttached();
    await expect(page.locator("#atualizacoesFeed .diario-oficial-card").first()).toContainText(/Edi..o/);
    await expect(page.locator("#atualizacoesFeed .diario-oficial-card").first()).toContainText(/Resumo cidad.o desta edi..o/);
    await expect(page.locator("#atualizacoesFeed .diario-oficial-card").first()).toContainText(/Compras\/contrata..es|Cargos|Leis|dado aberto/i);
    const pdf = page.locator("#atualizacoesFeed .diario-oficial-card").first().locator("a", { hasText: /Abrir PDF da edi..o/ });
    await expect(pdf).toBeVisible();
    await expect(pdf).toHaveAttribute("href", /\/portal\/diario-oficial\/ver\/\d+\//);
  });

  test("Filtro Câmara mostra contratos (regressão: chunk camara_betha)", async ({ page }) => {
    await page.goto(fileUrl("atualizacoes.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    // Clica no chip Câmara
    await page.locator('#atualizacoesFiltros .cat-chip').filter({ hasText: /C.mara/ }).click();
    await page.waitForTimeout(300);
    // Espera pelo menos 1 card de Câmara aparecer (deveria ter 36 contratos reais)
    const cards = page.locator("#atualizacoesFeed .tline-item");
    await expect(cards.first()).toBeAttached();
    // Empty state NÃO deve aparecer
    const empty = page.locator("#atualizacoesEmpty");
    await expect(empty).toBeHidden();
  });

  test("Filtro de busca responde", async ({ page }) => {
    await page.goto(fileUrl("atualizacoes.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const busca = page.locator("#filtroAtualizacoes");
    await busca.fill("inexistente_xyz_123");
    await page.waitForTimeout(300);
    const empty = page.locator("#atualizacoesEmpty");
    await expect(empty).toBeVisible();
  });
});

test.describe("Aba Diárias (regressão)", () => {
  test("Prefeitura — aba Diárias mostra bloco no DOM", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.locator('.pref-tab[data-pref-tab="diarias"]').first().click();
    await page.waitForTimeout(500);
    // Bloco principal de diárias precisa estar no DOM (ID sem acento)
    const block = page.locator("#diariasPrefeituraBlock");
    await expect(block).toBeAttached();
    await expect(page.locator("#filtroMesDiariasPrefeitura")).toBeAttached();
    await expect(page.locator("#rankingDiariasPrefeitura")).toContainText("Ranking acumulado anual");
    await expect(page.locator("#rankingDiariasPrefeitura")).toContainText("Ranking mensal");
  });

  test("Câmara — aba Diárias mostra bloco no DOM", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.locator('.csec-btn[data-go="diarias"]').click();
    await page.waitForTimeout(500);
    const block = page.locator("#diariasCamaraBlock");
    await expect(block).toBeAttached();
    await expect(page.locator("#filtroMesDiariasCamara")).toBeAttached();
    await expect(page.locator("#rankingDiariasCamara")).toContainText("Ranking acumulado anual");
    await expect(page.locator("#rankingDiariasCamara")).toContainText("Ranking mensal");
  });
});

test.describe("Per-capita no placar", () => {
  test("Prefeitura mostra valor por morador no card de total", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const pc = page.locator("#placarPrefeitura .placar-card__percapita").first();
    await expect(pc).toContainText("por morador");
  });
});

test.describe("Banner de boas-vindas (onboarding)", () => {
  test("aparece na primeira visita e some ao fechar", async ({ page }) => {
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("fiscaliza.onboarding.v1"));
    await page.reload();
    await page.waitForTimeout(2000);
    const banner = page.locator("#onboarding-banner");
    await expect(banner).toBeVisible();
    await banner.locator(".onboarding__close").click();
    await page.waitForTimeout(400);
    await expect(banner).toHaveCount(0);
    // Não reaparece após recarregar (flag persistida)
    await page.reload();
    await page.waitForTimeout(2000);
    await expect(page.locator("#onboarding-banner")).toHaveCount(0);
  });
});

test.describe("Classificação cidadã de matérias", () => {
  test("dados têm grau/tema e materiaCard rendeza selo + por que acompanhar", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.ZELA && window.ZELA.materiaCard && window.ZELA_DATA?.camara_anos), null, { timeout: 15_000 });
    const r = await page.evaluate(() => {
      const anos = (window.ZELA_DATA && window.ZELA_DATA.camara_anos) || {};
      const ano = Object.keys(anos)[0];
      const mats = (anos[ano] && anos[ano].materias) || [];
      const classificadas = mats.filter((m) => m.grau && m.tema).length;
      // Card de uma matéria de alto impacto, se houver
      const esc = (s) => String(s == null ? "" : s);
      const alta = mats.find((m) => m.grau === "alto") || mats[0];
      const html = window.ZELA.materiaCard ? window.ZELA.materiaCard(alta, esc) : "";
      return { total: mats.length, classificadas, grau: alta && alta.grau, html };
    });
    expect(r.total).toBeGreaterThan(0);
    expect(r.classificadas).toBe(r.total); // todas classificadas
    expect(r.html).toContain("mat-selo");
    expect(r.html).toMatch(/Por que acompanhar|Classificada como simbólica/);
  });
});

test.describe("Resumo Semanal", () => {
  test("bloco renderiza e mostra matérias ou estado vazio", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.locator('.csec-btn[data-go="atividade"]').click();
    const block = page.locator("#resumoSemanalBlock");
    await expect(block).toBeAttached();
    // Feed ou empty-state — um dos dois está visível
    const feed = page.locator("#resumoSemanalFeed");
    const empty = page.locator("#resumoSemanalEmpty");
    const feedVisible  = await feed.isVisible().catch(() => false);
    const emptyVisible = await empty.isVisible().catch(() => false);
    expect(feedVisible || emptyVisible).toBeTruthy();
  });

  test("filtro de período 'Este mês' retorna matérias", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.locator('.csec-btn[data-go="atividade"]').click();
    await page.locator('#resumoPeriodoChips .rs-chip[data-periodo="mes"]').click();
    await page.waitForTimeout(300);
    const counter = page.locator("#resumoContador");
    await expect(counter).toBeAttached();
  });

  test("chips de grau filtram por impacto", async ({ page }) => {
    await page.goto(fileUrl("camara.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.locator('.csec-btn[data-go="atividade"]').click();
    // Primeiro expande para 'Este mês' para ter dados
    await page.locator('#resumoPeriodoChips .rs-chip[data-periodo="mes"]').click();
    await page.waitForTimeout(300);
    // Filtra só ALTO
    await page.locator('#resumoGrauChips .rs-chip[data-grau="alto"]').click();
    await page.waitForTimeout(300);
    // Não deve haver erro no console (já coberto por smoke geral)
    const counter = page.locator("#resumoContador");
    await expect(counter).toBeAttached();
  });
});

test.describe("Watchlist", () => {
  test("estado vazio aparece quando localStorage não tem nada", async ({ page }) => {
    await page.goto(fileUrl("marcadores.html"), { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("zela.watchlist.v1"));
    await page.reload();
    await page.waitForTimeout(2000);
    const vazio = page.locator(".marcadores-vazio");
    await expect(vazio).toBeAttached();
  });
});

// ============================================================================
// Rede de proteção das features construídas (rodapé, LAIs, diárias, siglas).
// Travam estrutura/comportamento — não valores da coleta diária.
// ============================================================================

test.describe("Siglas de secretaria (utils.siglaSecretaria)", () => {
  test("mapeia nomes oficiais para a sigla certa e mantém desconhecidos", async ({ page }) => {
    setupConsoleListener(page);
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const f = window.ZELA.utils.siglaSecretaria;
      return {
        saude: f("SECRETARIA MUNICIPAL DE SAUDE"),
        saudeAcento: f("Secretaria Municipal da Saúde"),
        adm: f("SECRETARIA MUNICIPAL DE ADMINISTRACAO"),
        obras: f("Secretaria de Obras e Serviços Urbanos"),
        economico: f("Secretaria Municipal de Desenvolvimento Econômico"),
        habitacao: f("Secretaria Municipal de Habitação e Desenvolvimento Social"),
        vice: f("GABIV – Gabinete do Vice-Prefeito"),
        governo: f("Secretaria Municipal de Governo"),
        desconhecida: f("Fundação Qualquer Coisa"),
      };
    });
    expect(r.saude).toBe("SEMUS");
    expect(r.saudeAcento).toBe("SEMUS");
    expect(r.adm).toBe("SEMAD");
    expect(r.obras).toBe("SOSUB");
    expect(r.economico).toBe("SEDEC");   // não pode cair em SEHAD
    expect(r.habitacao).toBe("SEHAD");
    expect(r.vice).toBe("GABIV");
    expect(r.governo).toBe("SEGOV");
    expect(r.desconhecida).toMatch(/Funda..o Qualquer Coisa/); // fallback = nome limpo
  });
});

test.describe("Como cobrar — LAIs (estrutura e filtro duplo)", () => {
  test("20 temas, chips por card, filtro nível+categoria e busca", async ({ page }) => {
    const erros = setupConsoleListener(page);
    await page.goto(fileUrl("cobrar.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);

    const cards = page.locator(".template-card");
    const total = await cards.count();
    expect(total).toBeGreaterThanOrEqual(20);

    // todo card tem chip (nível + categoria) injetado pelo app.js
    await expect(page.locator(".lai-chips")).toHaveCount(total);
    await expect(cards.first().locator(".lai-chips")).toContainText("Nível");

    // filtro por nível 1 reduz e mantém pelo menos um
    await page.locator('.lai-filter-nivel[data-nivel="1"]').click();
    await page.waitForTimeout(250);
    const nivel1 = await page.locator(".template-card:visible").count();
    expect(nivel1).toBeGreaterThan(0);
    expect(nivel1).toBeLessThan(total);

    // somar categoria (filtro duplo) não pode aumentar a contagem
    await page.locator('.lai-filter[data-cat="licitacao"]').click();
    await page.waitForTimeout(250);
    const dual = await page.locator(".template-card:visible").count();
    expect(dual).toBeLessThanOrEqual(nivel1);

    // reset + busca
    await page.locator('.lai-filter-nivel[data-nivel="all"]').click();
    await page.locator('.lai-filter[data-cat="all"]').click();
    await page.locator("#laiBusca").fill("merenda");
    await page.waitForTimeout(250);
    expect(await page.locator(".template-card:visible").count()).toBeGreaterThanOrEqual(1);

    expect(erros).toEqual([]);
  });
});

test.describe("Rodapé padronizado", () => {
  const PAGS = ["index","atualizacoes","prefeitura","camara","relatorios","sobre","cobrar","marcadores","pessoal"];
  for (const p of PAGS) {
    test(`${p}: navegação, fontes e data dinâmica`, async ({ page }) => {
      setupConsoleListener(page);
      await page.goto(fileUrl(p + ".html"), { waitUntil: "domcontentloaded" });
      await expect(page.locator(".footer__inner")).toHaveCount(1);
      await expect(page.locator(".footer__nav a")).toHaveCount(8);
      await expect(page.locator(".footer__sources a")).toHaveCount(7);
      await expect(page.locator("#footerAtualizado")).not.toHaveText("—", { timeout: 15000 });
      await expect(page.locator("#footerAtualizado")).not.toHaveText("", { timeout: 15000 });
    });
  }
});

test.describe("Diárias — ranking não invade a coluna e usa sigla", () => {
  test("Prefeitura: valor dentro do painel e secretaria abreviada", async ({ page }) => {
    setupConsoleListener(page);
    await page.goto(fileUrl("prefeitura.html"), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const tab = page.locator('[data-pref-tab]').filter({ hasText: /Di.rias/ }).first();
    if (await tab.count()) await tab.click();
    await page.locator(".diaria-rank-row__function").first().waitFor({ timeout: 8000 });

    const r = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".diaria-rank-row--compact"));
      let overflow = 0;
      rows.forEach((row) => {
        const b = row.querySelector("b");
        const panel = row.closest(".diarias-ranking__panel") || row.parentElement;
        if (b && panel && b.getBoundingClientRect().right > panel.getBoundingClientRect().right + 1) overflow++;
        if (row.scrollWidth > row.clientWidth + 1) overflow++;
      });
      const cell = document.querySelector(".diaria-rank-row__function");
      return {
        rows: rows.length,
        overflow,
        sigla: cell ? cell.childNodes[0].textContent.trim() : "",
        title: cell ? cell.getAttribute("title") : "",
      };
    });
    expect(r.rows).toBeGreaterThan(0);
    expect(r.overflow).toBe(0);                 // nada invadindo a coluna direita
    expect(r.sigla.length).toBeLessThanOrEqual(8); // sigla curta, não o nome inteiro
    expect((r.title || "").length).toBeGreaterThan(r.sigla.length); // nome completo no hover
  });
});
