// @ts-check
const { defineConfig, devices } = require("@playwright/test");
const testPort = process.env.FISCALIZA_TEST_PORT || "4173";
const baseURL = `http://127.0.0.1:${testPort}`;
module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // 1 worker sempre: a suite carrega bases pesadas via file:// e 2 workers
  // disputando CPU geravam falhas intermitentes (timeouts falsos).
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],

  webServer: process.env.FISCALIZA_MANAGED_TEST_SERVER === "1" ? undefined : {
    command: "python scripts/serve-static-tests.py",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },

  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      testIgnore: /(?:http|emendas-audit|deploy)\.spec\.js/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "http",
      testMatch: /(?:http|emendas-audit)\.spec\.js/,
      use: { baseURL },
    },
  ],
});
