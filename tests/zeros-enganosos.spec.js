// @ts-check
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Trava contra a regra editorial nº 1 do projeto: nunca afirmar o que a fonte
 * não diz. O jeito mais comum de violá-la aqui não é escrever um número errado
 * — é deixar o desconhecido virar zero e publicar "R$ 0,00" com cara de fato.
 *
 * Casos reais que motivaram cada asserção (27/08/2026):
 *   - A home publicava "DIÁRIAS 0 · R$ 0,00 em diárias" porque diarias.json
 *     (3,2 MB) não entra nos chunks da home: `(D.diarias||{}).prefeitura||[]`
 *     dava array vazio para uma base com 5.749 registros e R$ 2,3 mi.
 *   - "0 para conferir" nas emendas, porque o campo `status` não existe nesta
 *     coleta e o filtro devolvia 0 — o painel dizendo que nada precisa de
 *     conferência quando o cruzamento sequer foi feito.
 *   - "R$ 0,00 movimentado (7 dias)" ao lado de "33 atos na semana".
 *
 * Zero legítimo continua permitido: empenho ainda não liquidado é R$ 0,00 de
 * verdade. O que estes testes proíbem é zero onde a base diz outra coisa.
 */

const RAIZ = path.resolve(__dirname, "..");
const CHUNKS = path.join(RAIZ, "painel-cidadao", "data", "chunks");

function lerChunk(nome) {
  const p = path.join(CHUNKS, `${nome}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

test.describe("Zeros enganosos — desconhecido não pode virar R$ 0,00", () => {
  test("home não publica diárias zeradas quando a base tem registros", async ({ page }) => {
    const diarias = lerChunk("diarias");
    const registros = Array.isArray(diarias?.prefeitura) ? diarias.prefeitura.length : 0;
    test.skip(registros === 0, "base de diárias vazia: não há o que comparar");

    await page.goto("/index.html");
    await page.waitForFunction(() => document.querySelectorAll(".home-stat").length > 0, null, {
      timeout: 20000,
    });

    const card = page.locator(".home-stat", { hasText: /Di[áa]rias/i }).first();
    const texto = (await card.innerText()).replace(/\s+/g, " ");

    expect(texto, `card de diárias afirmando R$ 0,00 com ${registros} registros na base`)
      .not.toMatch(/R\$\s*0,00/);
    expect(texto, "card de diárias mostrando contagem zero com base preenchida")
      .not.toMatch(/(^|\s)0(\s|$)/);
  });

  test("home não afirma '0 para conferir' sem a classificação de pendência", async ({ page }) => {
    const emendas = lerChunk("emendas");
    test.skip(!Array.isArray(emendas) || !emendas.length, "sem emendas publicadas");

    const temClassificacao = emendas.some((e) => e && e.status);
    test.skip(temClassificacao, "coleta traz o campo status: o número é apurável");

    await page.goto("/index.html");
    await page.waitForFunction(() => document.querySelectorAll(".home-stat").length > 0, null, {
      timeout: 20000,
    });

    const card = page.locator(".home-stat", { hasText: /Emendas/i }).first();
    const texto = (await card.innerText()).replace(/\s+/g, " ");
    expect(texto, "sem o campo status, o painel não pode afirmar '0 para conferir'")
      .not.toMatch(/\b0\s+para conferir\b/);
  });

  for (const pagina of [
    "index.html",
    "prefeitura.html",
    "camara.html",
    "relatorios.html",
    "pessoal.html",
    "atualizacoes.html",
    "fundacao.html",
  ]) {
    test(`${pagina} não vaza NaN, undefined ou [object Object] para o cidadão`, async ({ page }) => {
      const erros = [];
      page.on("pageerror", (e) => erros.push(e.message));

      await page.goto(`/${pagina}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1200);

      const texto = await page.evaluate(() => document.body.innerText);
      for (const lixo of ["NaN", "undefined", "[object Object]", "Infinity"]) {
        expect(texto, `"${lixo}" visível na página — cálculo com dado ausente`)
          .not.toContain(lixo);
      }
      expect(erros, `erro de JavaScript em ${pagina}`).toEqual([]);
    });
  }
});
