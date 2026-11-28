import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:4174",
    viewport: { width: 1100, height: 850 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4174 --strictPort --base /migration/",
    url: "http://127.0.0.1:4174/migration/",
    reuseExistingServer: false,
  },
  projects: [
    { name: "app-chromium", use: { browserName: "chromium" } },
    { name: "app-webkit", use: { browserName: "webkit" } },
  ],
});
