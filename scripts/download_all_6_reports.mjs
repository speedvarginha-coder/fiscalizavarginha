import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = path.join(root, "documentos", "relatorios_emendas_betha_2026_09_01");
fs.mkdirSync(targetDir, { recursive: true });

async function run() {
  console.log("=== INICIANDO DOWNLOAD PRECISO DOS 6 RELATÓRIOS DO PORTAL BETHA ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    acceptDownloads: true
  });
  const page = await context.newPage();

  console.log("Acessando https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/295943 ...");
  await page.goto("https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/295943", {
    waitUntil: "networkidle",
    timeout: 60000
  });

  await page.waitForTimeout(5000);

  const rows = await page.$$("table tbody tr");
  console.log(`Total de linhas encontradas: ${rows.length}`);

  const relatoriosBaixados = [];

  for (let i = 0; i < rows.length; i++) {
    const currentRows = await page.$$("table tbody tr");
    const row = currentRows[i];
    if (!row) continue;

    const rowText = await row.innerText();
    const cleanText = rowText.replace(/\t+/g, " | ").replace(/\n+/g, " ").trim();
    console.log(`\n--------------------------------------------------`);
    console.log(`Linha ${i + 1}: ${cleanText}`);

    // Extrair o ano da primeira coluna: ex "2026 | 01/09/2026..." -> 2026
    const partes = cleanText.split("|").map(p => p.trim());
    const ano = partes[0] || (cleanText.startsWith("2025") ? "2025" : "2026");

    let esfera = "Geral";
    if (/federal|federais/i.test(cleanText)) esfera = "Federal";
    else if (/estadual|estaduais/i.test(cleanText)) esfera = "Estadual";
    else if (/municipal|municipais/i.test(cleanText)) esfera = "Municipal";

    const finalFilename = `Emendas_${esfera}_${ano}.pdf`;
    const destPath = path.join(targetDir, finalFilename);

    console.log(`Destino planejado: ${finalFilename}`);

    const verBtn = await row.$("a:has-text('Ver arquivos'), button:has-text('Ver arquivos')");
    if (!verBtn) {
      console.log("Botão 'Ver arquivos' não encontrado.");
      continue;
    }

    await verBtn.click();
    await page.waitForTimeout(3000);

    const modal = await page.$(".modal.in, .modal.show, [role='dialog']");
    if (!modal) {
      console.log("Modal não abriu.");
      continue;
    }

    const downloadBtn = await modal.$("button[title*='Baixar'], button:has(.fa-download), .bth-attach-item__actions-item");
    if (downloadBtn) {
      console.log("Clicando no botão de download...");
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15000 }),
        downloadBtn.click()
      ]);

      const origFilename = download.suggestedFilename();
      await download.saveAs(destPath);
      const stats = fs.statSync(destPath);
      console.log(`✔ SUCESSO! Arquivo salvo: ${finalFilename} (${stats.size} bytes) - Original: ${origFilename}`);

      relatoriosBaixados.push({
        ano,
        esfera,
        arquivoOriginal: origFilename,
        arquivoSalvo: finalFilename,
        caminhoCompleto: destPath,
        tamanhoBytes: stats.size,
        linhaTabela: cleanText
      });
    } else {
      console.log("Botão de download não encontrado no modal.");
    }

    const closeBtn = await modal.$("button:has-text('FECHAR'), button:has-text('Fechar'), .close, [data-dismiss='modal']");
    if (closeBtn) {
      await closeBtn.click();
    } else {
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(2000);
  }

  const manifestPath = path.join(targetDir, "manifesto_relatorios.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    dataDownload: new Date().toISOString(),
    origem: "https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/295943",
    totalRelatorios: relatoriosBaixados.length,
    relatorios: relatoriosBaixados
  }, null, 2), "utf8");

  console.log(`\n==================================================`);
  console.log(`TODOS OS ${relatoriosBaixados.length} RELATÓRIOS FORAM BAIXADOS COM SUCESSO!`);
  console.log(`Manifesto salvo em: ${manifestPath}`);

  await browser.close();
}

run().catch(err => {
  console.error("Erro:", err);
  process.exit(1);
});
