// Headed Playwright profile of the globe example: waits for geometry, then
// zooms with the wheel and pans while recording frames and CPU time.
// Usage: node scripts/profile-globe-browser.mjs [root] [port] [atlas] [runs]
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "."),
  port = process.argv[3] ?? "4192",
  atlas = process.argv[4] ?? "50m",
  runs = Number(process.argv[5] ?? 3),
  headless = process.env.HEADLESS === "1";
const server = spawn("node", ["examples/progressive/server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: port },
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 1500));
const results = [];
for (let run = 0; run < runs; run++) {
  const context = await chromium.launchPersistentContext(
    await mkdtemp(join(tmpdir(), "qs-prof-")),
    { headless, viewport: { width: 1100, height: 850 } },
  );
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(
    `http://127.0.0.1:${port}/examples/globe/index.html?atlas=${atlas}`,
  );
  await page.waitForSelector("#status[data-phase=ready]", { timeout: 900000 });
  const readyMs = Date.now() - t0;
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (t) => {
      window.__frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.start");
  const box = await page.locator("#globe").boundingBox(),
    cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  const t1 = Date.now();
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(120);
  }
  for (let i = 0; i < 8; i++) {
    await page.mouse.down();
    await page.mouse.move(cx + (i % 2 ? -120 : 120), cy + 30, { steps: 6 });
    await page.mouse.up();
  }
  await page.waitForSelector("#status[data-phase=ready]", { timeout: 900000 });
  const interactMs = Date.now() - t1;
  const { profile } = await cdp.send("Profiler.stop");
  const frames = await page.evaluate(() => window.__frames.slice(1));
  frames.sort((a, b) => a - b);
  const q = (p) => frames[Math.floor((frames.length - 1) * p)] ?? 0;
  const self = new Map(),
    byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => {
    const f = byId.get(id).callFrame,
      k = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber}`;
    self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  });
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const idle = self.get("(idle) :-1") ?? 0;
  await page.locator("details summary").click();
  const diag = await page.locator("#diagnostics").innerText();
  results.push({
    run: run + 1,
    readyMs,
    interactMs,
    frameP50: +q(0.5).toFixed(1),
    frameP95: +q(0.95).toFixed(1),
    frameMax: +q(1).toFixed(1),
    busyMs: Math.round([...self.values()].reduce((a, b) => a + b, 0) - idle),
    top: top.map(([k, v]) => `${Math.round(v)}ms ${k}`),
    diag: diag.replace(/\s+/g, " ").slice(0, 200),
  });
  await context.close();
}
server.kill();
console.log(JSON.stringify(results, null, 1));
