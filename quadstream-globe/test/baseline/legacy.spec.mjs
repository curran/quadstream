import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { cameraTrace, summarizeSamples } from "../support/baseline.mjs";

async function ready(page) {
  await page.waitForFunction(
    () => {
      const d = document.querySelector("#globe")?.dataset;
      return (
        d &&
        document.querySelector("#status")?.dataset.phase === "ready" &&
        d.mode === "quadstream" &&
        d.interacting === "false" &&
        Math.abs(Number(d.renderedLevel) - Number(d.targetLevel)) < 0.001 &&
        Number(d.requests) > 0 &&
        Number(d.sourceVertices) > 0
      );
    },
    null,
    { timeout: 60000 },
  );
}

test("capture settled legacy views and observable geometry", async ({
  page,
  browser,
}, testInfo) => {
  await page.addInitScript(() =>
    localStorage.setItem("quadstream-globe-nav", '{"smooth":false}'),
  );
  const start = performance.now();
  await page.goto("/examples/globe/index.html?fixture=1");
  await ready(page);
  const startupMs = performance.now() - start;
  const views = [];
  const samples = [];
  for (const view of cameraTrace) {
    const began = performance.now();
    await page.evaluate(({ rotation, zoom }) => {
      const initial = Number(
        document.querySelector("#globe").dataset.initialScale,
      );
      globalThis.globeDebug.setView({ rotation, scale: initial * zoom });
    }, view);
    await expect
      .poll(() =>
        page
          .locator("#globe")
          .evaluate((el) => JSON.parse(el.dataset.rotation)),
      )
      .toEqual(view.rotation);
    await expect
      .poll(() =>
        page
          .locator("#globe")
          .evaluate(
            (el, zoom) =>
              Math.abs(
                Number(el.dataset.scale) / Number(el.dataset.initialScale) -
                  zoom,
              ),
            view.zoom,
          ),
      )
      .toBeLessThan(0.001);
    await ready(page);
    samples.push(performance.now() - began);
    const diagnostics = await page.locator("#globe").evaluate((el) => ({
      rotation: JSON.parse(el.dataset.rotation),
      scale: Number(el.dataset.scale),
      initialScale: Number(el.dataset.initialScale),
      level: Number(el.dataset.renderedLevel),
      vertices: Number(el.dataset.vertices),
      sourceVertices: Number(el.dataset.sourceVertices),
      requests: Number(el.dataset.requests),
    }));
    expect(
      Object.values(diagnostics)
        .filter((v) => typeof v === "number")
        .every(Number.isFinite),
    ).toBe(true);
    expect(diagnostics.vertices).toBeGreaterThan(0);
    await page
      .locator("#globe")
      .screenshot({ path: testInfo.outputPath(view.id + ".png") });
    views.push({ id: view.id, diagnostics });
  }
  const path = testInfo.outputPath("legacy-baseline.json");
  await writeFile(
    path,
    JSON.stringify(
      {
        fixture: "legacy fixture=1",
        browser: browser.version(),
        viewport: page.viewportSize(),
        dpr: 1,
        platform: process.platform,
        architecture: process.arch,
        startupMs,
        // Includes Playwright polling overhead; not a render-frame benchmark.
        observedConvergenceMs: summarizeSamples(samples),
        views,
      },
      null,
      2,
    ) + "\n",
  );
  await testInfo.attach("legacy-baseline", {
    path,
    contentType: "application/json",
  });
});
