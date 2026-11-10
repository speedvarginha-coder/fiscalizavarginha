import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = path.join(root, "documentos", "relatorios_emendas_betha_2026_09_01");
fs.mkdirSync(targetDir, { recursive: true });

async function run() {
  console.log("Iniciando Chromium para acessar Betha...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    acceptDownloads: true
  });
  const page = await context.newPage();

  const apiCalls = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("transparencia") || url.includes("betha")) {
      apiCalls.push({ status: response.status(), url });
      console.log(`[API] ${response.status()} ${url}`);
    }
  });

  console.log("Navegando para consulta 295943...");
  await page.goto("https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/295943", {
    waitUntil: "networkidle",
    timeout: 60000
  });

  await page.waitForTimeout(6000);

  const title = await page.title();
  console.log("Título da página:", title);

  await page.screenshot({ path: path.join(targetDir, "screenshot_consulta.png"), fullPage: true });
  console.log("Screenshot salva em screenshot_consulta.png");

  const pageInfo = await page.evaluate(() => {
    return {
      bodyText: document.body.innerText.slice(0, 3000),
      buttons: Array.from(document.querySelectorAll("button, a")).map(b => ({
        tag: b.tagName,
        text: b.innerText?.trim(),
        href: b.getAttribute("href"),
        class: b.className,
        id: b.id
      })).filter(b => b.text && b.text.length > 1)
    };
  });

  console.log("Body text inicial:\n", pageInfo.bodyText);
  console.log("Botões e links:\n", JSON.stringify(pageInfo.buttons, null, 2));

  fs.writeFileSync(path.join(targetDir, "page_info.json"), JSON.stringify(pageInfo, null, 2), "utf8");

  await browser.close();
}

run().catch(err => {
  console.error("Erro:", err);
  process.exit(1);
});
