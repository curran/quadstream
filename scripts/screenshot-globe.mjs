// Usage: node scripts/screenshot-globe.mjs out.png [atlas] [level] [port]
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
const [out, atlas = "110m", level = "1.8", port = "4197"] =
  process.argv.slice(2);
const server = spawn("node", ["examples/progressive/server.mjs"], {
  env: { ...process.env, PORT: port },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1900, height: 970 } });
await page.goto(
  `http://127.0.0.1:${port}/examples/globe/index.html?atlas=${atlas}`,
);
await page.waitForSelector("#status[data-phase=ready]", { timeout: 300000 });
await page.locator("#level").fill(level);
await page.waitForFunction(
  (l) => document.querySelector("#globe").dataset.renderedLevel === l,
  level,
  { timeout: 300000 },
);
await page.waitForTimeout(500);
console.log(await page.locator("#status").innerText());
await page.screenshot({ path: out });
await browser.close();
server.kill();
