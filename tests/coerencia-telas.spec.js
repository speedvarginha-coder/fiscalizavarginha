// @ts-check
/**
 * Coerência entre telas — Fiscaliza Varginha
 *
 * Um mesmo número não pode aparecer diferente em duas páginas na mesma visita.
 * Cada caso aqui é uma regressão real encontrada em 10/09/2026 navegando o site
 * como cidadão:
 *
 *   - a home anunciava "0 diárias" enquanto a Prefeitura mostrava 6.053, porque
 *     a home não carrega esse chunk e o código lia só ele;
 *   - a aba prometia 1.336 contratos e a lista entregava 866 sem dizer que
 *     estava filtrada no ano corrente.
 *
 * O teste compara o que está na tela com o que está no dado coletado, nunca com
 * um número escrito à mão — assim ele continua valendo depois de cada coleta.
 */
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const PAINEL = path.resolve(__dirname, "..", "painel-cidadao");
const CHUNKS = path.join(PAINEL, "data", "chunks");
const url = (page) => `http://127.0.0.1:${process.env.FISCALIZA_TEST_PORT || "4173"}/` + page;

const lerChunk = (nome) =>
  JSON.parse(fs.readFileSync(path.join(CHUNKS, `${nome}.json`), "utf8"));

/** Navega e espera o sinal de fim de inicialização do painel. */
async function abrir(page, destino) {
  await page.goto(url(destino));
  await expect(page.locator("body"), `painel não inicializou em ${destino}`)
    .toHaveAttribute("data-fiscaliza-ready", "true", { timeout: 45_000 });
}

/** "6.053 registro(s) em 2026 · R$ 1.082.701,87" -> 6053 */
const primeiroInteiro = (texto) => {
  const m = String(texto || "").match(/-?[\d.]+/);
  return m ? Number(m[0].replace(/\./g, "")) : NaN;
};

/** "Diárias 6053" -> 6053. O rótulo da aba vem antes do número. */
const ultimoInteiro = (texto) => {
  const m = String(texto || "").match(/[\d.]+/g);
  return m ? Number(m[m.length - 1].replace(/\./g, "")) : NaN;
};

test.describe("Coerência entre telas", () => {
  test("diárias: home e Prefeitura mostram o mesmo total da base", async ({ page }) => {
    const esperado = lerChunk("diarias").resumo.prefeitura.registros;
    expect(esperado, "chunk de diárias sem resumo").toBeGreaterThan(0);

    await abrir(page, "index.html");
    const prioridadeDiarias = page.locator(".priority-row", { hasText: "Diárias" }).first();
    // O sinal geral de inicialização antecede o preenchimento dos cartões.
    await expect(prioridadeDiarias).toContainText(
      `${esperado.toLocaleString("pt-BR")} registros de diárias`, { timeout: 30_000 }
    );
    const cardHome = await prioridadeDiarias.innerText();
    expect(
      primeiroInteiro(cardHome.replace(/^\s*\d+\s/, "")),
      `home diz "${cardHome.replace(/\s+/g, " ").trim()}" e a base tem ${esperado}`
    ).toBe(esperado);

    await abrir(page, "prefeitura.html");
    // O chunk de diárias só é carregado quando a aba é aberta; até lá o selo
    // mostra "…". Abrir a aba é o que o cidadão faz, então é o que o teste faz.
    const seloDiarias = page.locator('.pref-tab[data-pref-tab="diarias"]');
    await seloDiarias.click();
    await expect(seloDiarias, "selo da aba de diárias continuou em '…' depois de abrir a aba")
      .toHaveText(/\d/, { timeout: 30_000 });
    expect(ultimoInteiro(await seloDiarias.innerText()), "selo da aba de diárias").toBe(esperado);

    const contador = await page.locator("#contadorDiariasPrefeitura").innerText();
    if (primeiroInteiro(contador) !== esperado) {
      expect(contador, `lista de diárias mostra recorte sem declarar o ano: "${contador}"`)
        .toMatch(/em \d{4}|todos os anos/i);
    }
  });

  test("contratos: selo da aba conta a base inteira e a lista declara o recorte", async ({ page }) => {
    const total = lerChunk("prefeitura").contratos.length;
    await abrir(page, "prefeitura.html");

    const seloContratos = page.locator('.pref-tab[data-pref-tab="contratos"]');
    await expect(seloContratos, "selo da aba de contratos nunca recebeu o número")
      .toHaveText(/\d/, { timeout: 30_000 });
    expect(ultimoInteiro(await seloContratos.innerText()), "selo da aba de contratos").toBe(total);

    await page.locator('.pref-tab[data-pref-tab="contratos"]').click();
    const contador = await page.locator("#contratosContador").innerText();
    // A lista pode mostrar menos que o selo, desde que diga por quê.
    if (primeiroInteiro(contador) !== total) {
      expect(contador, `lista mostra recorte diferente do selo sem declarar o ano: "${contador}"`)
        .toMatch(/em \d{4}|todos os anos/i);
    }
  });

  test("licitação em andamento nunca aparece sem ano quando a fonte mandou a data", async ({ page }) => {
    const licitacoes = lerChunk("prefeitura").licit_andamento || [];
    const comData = licitacoes.filter((l) => l.data);
    test.skip(comData.length === 0, "nenhuma licitação em andamento com data nesta coleta");

    await abrir(page, "prefeitura.html");
    await page.locator('.pref-tab[data-pref-tab="visao"]').click();
    const painel = page.locator("#gastosPalavraChave");
    await expect(painel).toBeVisible();
    await expect(
      painel,
      "o painel por palavra-chave está publicando 'Sem ano informado' para registro que tem data"
    ).not.toContainText("Sem ano informado");
  });

  test("o selo de frescor obedece a janela declarada em status_fontes", async ({ page }) => {
    const fontes = lerChunk("status_fontes");
    const limite = Number(fontes?.domains?.atualizado_em?.max_age_days) || 3;
    const iso = lerChunk("atualizado_em").iso;
    const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

    await abrir(page, "index.html");
    const carimbo = page.locator(".carimbo-coleta").first();
    await expect(carimbo).toBeVisible();
    const classe = (await carimbo.getAttribute("class")) || "";

    if (dias > limite) {
      expect(
        classe,
        `coleta com ${dias} dias passou da janela de ${limite}, mas o selo continua verde`
      ).not.toContain("carimbo-coleta--fresh");
    } else {
      expect(classe, `coleta com ${dias} dias está dentro da janela de ${limite}`)
        .toContain("carimbo-coleta--fresh");
    }
  });
});
