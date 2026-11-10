import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = path.join(root, "documentos", "relatorios_emendas_betha_2026_09_01");
fs.mkdirSync(targetDir, { recursive: true });

async function run() {
  console.log("Iniciando Chromium para inspecionar e baixar relatórios Betha...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    acceptDownloads: true
  });
  const page = await context.newPage();

  // Escutar downloads
  page.on("download", async (download) => {
    const suggestedFilename = download.suggestedFilename();
    const savePath = path.join(targetDir, suggestedFilename);
    console.log(`[DOWNLOAD DETECTADO] Salvando ${suggestedFilename} em ${savePath}`);
    await download.saveAs(savePath);
    console.log(`[DOWNLOAD COMPLETO] ${suggestedFilename}`);
  });

  // Interceptar todas as respostas para achar links de arquivos/PDFs
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("arquivo") || url.includes("anexo") || url.includes("download") || url.includes("relatorio") || url.includes(".pdf")) {
      console.log(`[ARQUIVO RESPONSE] ${response.status()} ${url}`);
    }
  });

  await page.goto("https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/295943", {
    waitUntil: "networkidle",
    timeout: 60000
  });

  await page.waitForTimeout(5000);

  // Localizar todas as linhas da tabela
  const rows = await page.$$("table tbody tr");
  console.log(`Linhas encontradas na tabela: ${rows.length}`);

  // Analisar o que há em cada linha
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const text = await row.innerText();
    console.log(`\n--- LINHA ${i + 1} ---`);
    console.log(text.replace(/\t/g, " | ").replace(/\n/g, " "));

    // Procurar botão/link "Ver arquivos" na linha
    const verArquivosBtn = await row.$("a:has-text('Ver arquivos'), button:has-text('Ver arquivos'), [title*='arquivo'], .btn-link");
    if (verArquivosBtn) {
      const btnText = await verArquivosBtn.innerText();
      console.log(`Clicando no botão: "${btnText}" da linha ${i + 1}...`);
      await verArquivosBtn.click();
      await page.waitForTimeout(3000);

      // Tirar screenshot do modal ou popup que abrir
      await page.screenshot({ path: path.join(targetDir, `modal_linha_${i + 1}.png`) });

      // Inspecionar o que abriu (modal, links para download)
      const modalInfo = await page.evaluate(() => {
        const modals = document.querySelectorAll(".modal.in, .modal.show, .modal-dialog, .ui-dialog, .popover, [role='dialog']");
        const links = [];
        for (const m of modals) {
          const aTags = m.querySelectorAll("a, button");
          for (const a of aTags) {
            links.push({
              text: a.innerText?.trim(),
              href: a.getAttribute("href"),
              onclick: a.getAttribute("onclick"),
              class: a.className
            });
          }
        }
        return {
          modalText: Array.from(modals).map(m => m.innerText).join("\n---\n"),
          links
        };
      });

      console.log(`Conteúdo do modal da linha ${i + 1}:\n`, modalInfo.modalText);
      console.log(`Links no modal:\n`, JSON.stringify(modalInfo.links, null, 2));

      // Se houver links de download no modal, clicar neles
      const downloadLinks = await page.$$(".modal.in a, .modal.show a, [role='dialog'] a, .modal a[href*='download'], .modal a[href*='arquivo']");
      for (const dl of downloadLinks) {
        const dlText = await dl.innerText();
        const dlHref = await dl.getAttribute("href");
        console.log(`Tentando baixar link do modal: "${dlText}" (href: ${dlHref})`);
        try {
          const [download] = await Promise.all([
            page.waitForEvent("download", { timeout: 10000 }).catch(() => null),
            dl.click()
          ]);
          if (download) {
            const fname = download.suggestedFilename();
            const sp = path.join(targetDir, fname);
            await download.saveAs(sp);
            console.log(`Baixado com sucesso: ${fname}`);
          }
        } catch (e) {
          console.log(`Erro ao clicar no download: ${e.message}`);
        }
        await page.waitForTimeout(2000);
      }

      // Fechar o modal
      const closeBtn = await page.$(".modal.in [data-dismiss='modal'], .modal.show [data-dismiss='modal'], .modal.in .close, .modal.show .close, button:has-text('Fechar'), button:has-text('FECHAR')");
      if (closeBtn) {
        console.log("Fechando modal...");
        await closeBtn.click();
        await page.waitForTimeout(2000);
      } else {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(2000);
      }
    }
  }

  await browser.close();
  console.log("\nProcesso finalizado.");
}

run().catch(err => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
