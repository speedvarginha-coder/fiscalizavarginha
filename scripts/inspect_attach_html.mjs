import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://transparencia.betha.cloud/#/y7mn01LGqd_HCvGtj6VPwA==/consulta/295943", {
    waitUntil: "networkidle",
    timeout: 60000
  });
  await page.waitForTimeout(4000);

  const btn = await page.$("table tbody tr:first-child a:has-text('Ver arquivos'), table tbody tr:first-child button:has-text('Ver arquivos')");
  if (btn) {
    await btn.click();
    await page.waitForTimeout(3000);
    const html = await page.evaluate(() => {
      const items = document.querySelectorAll(".bth-attach-item, [class*='attach'], .modal-body");
      return Array.from(items).map(el => el.outerHTML).slice(0, 10);
    });
    console.log("HTML DE ATTACH:");
    console.log(html.join("\n---\n"));
  }
  await browser.close();
}
run().catch(console.error);
