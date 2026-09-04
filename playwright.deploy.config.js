const { defineConfig } = require("@playwright/test");
const path = require("path");
const port = process.env.FISCALIZA_DEPLOY_TEST_PORT || "4184";
const baseURL = `http://127.0.0.1:${port}`;
module.exports = defineConfig({
  testDir: "./tests",
  testMatch: /deploy\.spec\.js/,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "tmp/test-results-deploy",
  use: { baseURL, headless: true },
  webServer: process.env.FISCALIZA_MANAGED_TEST_SERVER === "1" ? undefined : {
    command: "python scripts/serve-static-tests.py",
    url: baseURL,
    reuseExistingServer: false,
    env: {
      FISCALIZA_TEST_ROOT: path.resolve(__dirname, process.env.FISCALIZA_DEPLOY_DIR || "dist", "painel-cidadao"),
      FISCALIZA_TEST_PORT: port,
    },
  },
});
