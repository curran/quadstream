import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/baseline",
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1100, height: 850 },
    deviceScaleFactor: 1,
    browserName: "chromium",
  },
  webServer: {
    command: "node ../examples/progressive/server.mjs --globe",
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: false,
    env: { PORT: "4173" },
  },
});
