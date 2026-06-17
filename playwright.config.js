// @ts-check
const { defineConfig, devices } = require("@playwright/test");
const path = require("path");

/** Painel Cidadão é estático (file://). Não precisa de webServer. */
module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // 1 worker sempre: a suite carrega bases pesadas via file:// e 2 workers
  // disputando CPU geravam falhas intermitentes (timeouts falsos).
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    // Servidos via file:// — o caminho absoluto é construído nos próprios testes.
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
