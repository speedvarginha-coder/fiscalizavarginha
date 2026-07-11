// @ts-check
const { test, expect } = require("@playwright/test");

test("pacote publico serve loader, chunk e modulo sem data.js", async ({ request }) => {
  const index = await request.get("/index.html");
  expect(index.ok()).toBeTruthy();
  const html = await index.text();
  expect(html).toContain('src="data-loader.js');
  expect(html).not.toMatch(/<script[^>]+src=["'][^"']*data\.js/i);

  for (const asset of [
    "/data-loader.js",
    "/data/chunks/resumo.json",
    "/modules/utils.js",
    "/modules/chat-cidadao.js",
  ]) {
    const response = await request.get(asset);
    expect(response.ok(), `${asset} deve responder via HTTP`).toBeTruthy();
    expect((await response.body()).length, `${asset} nao deve estar vazio`).toBeGreaterThan(0);
  }
});
