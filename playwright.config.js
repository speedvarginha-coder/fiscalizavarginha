// @ts-check
const { defineConfig, devices } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // 1 worker sempre: a suite carrega bases pesadas via file:// e 2 workers
  // disputando CPU geravam falhas intermitentes (timeouts falsos).
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],

  webServer: {
    command: "python -m http.server 4173 --directory painel-cidadao",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },

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
      testIgnore: /http\.spec\.js/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "http",
      testMatch: /http\.spec\.js/,
      use: { baseURL: "http://127.0.0.1:4173" },
    },
  ],
});
