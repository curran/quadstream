import { MIN_AUTO_LEVEL } from "../../examples/globe/lod.mjs";

// Both applications register the identical scenarios with their own Playwright instance.
export function registerGlobeSuite(test, expect, { entry }) {
  const url = entry + "?fixture=1";
  const globe = (page) => page.locator("#globe");
  async function openSettings(page) {
    if (await page.locator("#panel").isHidden())
      await page.locator("#settings-toggle").click();
  }
  // Existing tests assert exact synchronous camera state, so they run with
  // smooth navigation off; the smoothing tests opt in with ?smooth=1.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem("quadstream-globe-nav", '{"smooth":false}'),
    );
  });
  // The status changes when the worker responds, before the next animation
  // frame publishes the canvas diagnostics. Wait for the actual requested frame.
  const ready = async (page) => {
    await page.waitForFunction(
      () => {
        const el = document.querySelector("#globe"),
          d = el.dataset;
        return (
          document.querySelector("#status").dataset.phase === "ready" &&
          d.mode === "quadstream" &&
          Math.abs(Number(d.renderedLevel) - Number(d.targetLevel)) < 0.001 &&
          !!d.rotation &&
          Number(d.scale) > 0 &&
          Number(d.requests) > 0 &&
          Number(d.sourceVertices) > 0 &&
          d.vertices !== undefined
        );
      },
      null,
      { timeout: 60000 },
    );
  };
  const state = async (page) =>
    globe(page).evaluate((el) => ({
      rotation: JSON.parse(el.dataset.rotation),
      scale: Number(el.dataset.scale),
      initial: Number(el.dataset.initialScale),
      requests: Number(el.dataset.requests),
      interacting: el.dataset.interacting === "true",
      level: Number(el.dataset.renderedLevel),
      vertices: Number(el.dataset.vertices),
      source: Number(el.dataset.sourceVertices),
    }));
  const near = (actual, expected) =>
    expect(Math.abs(actual - expected)).toBeLessThan(0.001);
  async function pointer(page, type, id, x, y, pointerType = "touch") {
    await globe(page).dispatchEvent(type, {
      pointerId: id,
      pointerType,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      isPrimary: id === 1,
    });
  }
  async function waitScale(page, value) {
    await expect
      .poll(async () => Math.abs((await state(page)).scale - value))
      .toBeLessThan(0.001);
  }
  async function manual(page, level) {
    await page.locator("#level").evaluate((el, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, level);
    await ready(page);
    await expect(globe(page)).toHaveAttribute(
      "data-rendered-level",
      String(Math.max(MIN_AUTO_LEVEL, level)),
    );
  }
  // Compare within one browser, at an identical idle camera and full LOD.
  async function compareFullPixels(page, label) {
    await ready(page);
    await expect(globe(page)).toHaveAttribute("data-interacting", "false");
    const before = await state(page);
    expect(before.level).toBe(19);
    await openSettings(page);
    await page.locator("#mode").selectOption("original");
    await expect(globe(page)).toHaveAttribute("data-mode", "original");
    // Keep the original raw RGBA buffer in the browser. PNG encoding/decoding
    // and drawing onto another canvas can introduce color/alpha rounding.
    const original = await globe(page).evaluateHandle((el) => ({
      width: el.width,
      height: el.height,
      data: el.getContext("2d").getImageData(0, 0, el.width, el.height).data,
    }));
    try {
      await page.locator("#mode").selectOption("quadstream");
      await ready(page);
      const after = await state(page);
      expect(after.rotation).toEqual(before.rotation);
      expect(after.scale).toBe(before.scale);
      expect(after.level).toBe(19);
      expect(after.interacting).toBe(false);
      const difference = await globe(page).evaluate((el, snapshot) => {
        if (el.width !== snapshot.width || el.height !== snapshot.height)
          throw new Error("Canvas size changed during comparison");
        const a = snapshot.data,
          b = el.getContext("2d").getImageData(0, 0, el.width, el.height).data;
        let n = 0;
        for (let i = 0; i < a.length; i += 4)
          if (
            Math.max(
              Math.abs(a[i] - b[i]),
              Math.abs(a[i + 1] - b[i + 1]),
              Math.abs(a[i + 2] - b[i + 2]),
              Math.abs(a[i + 3] - b[i + 3]),
            ) > 12
          )
            n++;
        return n / (el.width * el.height);
      }, original);
      expect(
        difference,
        label + " differing pixel fraction: " + difference,
      ).toBeLessThan(0.005);
    } finally {
      await original.dispose();
    }
  }
  // Each camera starts from Reset; the debug hook jumps the camera without
  // animation so views are exact regardless of smoothing.
  async function atlasView(page, rotation, zoom) {
    await page.locator("#reset").click();
    await page.evaluate(
      ({ rotation, zoom }) => {
        const initial = Number(
          document.querySelector("#globe").dataset.initialScale,
        );
        globalThis.globeDebug.setView({ rotation, scale: initial * zoom });
      },
      { rotation, zoom },
    );
    await expect
      .poll(async () => (await state(page)).rotation)
      .toEqual(rotation);
    await expect
      .poll(async () =>
        Math.abs(
          (await state(page)).scale / (await state(page)).initial - zoom,
        ),
      )
      .toBeLessThan(0.001);
    await expect(globe(page)).toHaveAttribute("data-interacting", "false");
  }
  test("mouse drag rotates without geometry queries; wheel zoom and keyboard work", async ({
    page,
  }) => {
    await page.goto(url);
    await ready(page);
    const a = await state(page);
    await page.mouse.move(500, 400);
    await page.mouse.down();
    await page.mouse.move(650, 450, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => (await state(page)).rotation[0])
      .toBeGreaterThan(a.rotation[0]);
    const b = await state(page);
    expect(b.requests).toBe(a.requests);
    await page.mouse.wheel(0, -600);
    await expect
      .poll(async () => (await state(page)).scale)
      .toBeGreaterThan(b.scale);
    await expect(globe(page)).toHaveAttribute("data-interacting", "false");
    const zoomed = await state(page);
    await globe(page).focus();
    await page.keyboard.down("ArrowRight");
    await expect
      .poll(async () => (await state(page)).rotation[0])
      .toBeLessThan(zoomed.rotation[0]);
    await page.keyboard.up("ArrowRight");
  });
  test("two consecutive pinches and one-two-one transitions preserve baseline and rotation", async ({
    page,
  }) => {
    await page.goto(url);
    await ready(page);
    const a = await state(page);
    await pointer(page, "pointerdown", 1, 400, 400);
    await pointer(page, "pointerdown", 2, 500, 400);
    await pointer(page, "pointermove", 2, 600, 400);
    await waitScale(page, a.scale * 2);
    expect((await state(page)).rotation[2]).toBe(0);
    await pointer(page, "pointerup", 2, 600, 400);
    await pointer(page, "pointermove", 1, 400, 400);
    await pointer(page, "pointermove", 1, 420, 400);
    await expect
      .poll(async () => (await state(page)).rotation[0])
      .toBeGreaterThan(a.rotation[0]);
    const b = await state(page);
    await pointer(page, "pointerup", 1, 420, 400);
    await pointer(page, "pointerdown", 3, 400, 400);
    await pointer(page, "pointerdown", 4, 500, 400);
    await pointer(page, "pointermove", 4, 450, 400);
    await waitScale(page, b.scale * 0.5);
    await pointer(page, "pointercancel", 4, 450, 400);
    await pointer(page, "lostpointercapture", 3, 400, 400);
    await expect(globe(page)).toHaveAttribute("data-interacting", "false");
  });
  test("three pointers pause, resume without scale jump and suppress native gestures", async ({
    page,
  }) => {
    await page.goto(url);
    await ready(page);
    const a = await state(page);
    await pointer(page, "pointerdown", 1, 400, 400);
    await pointer(page, "pointerdown", 2, 500, 400);
    await pointer(page, "pointerdown", 3, 600, 400);
    await pointer(page, "pointermove", 2, 550, 400);
    await waitScale(page, a.scale);
    await pointer(page, "pointerup", 1, 400, 400);
    await pointer(page, "pointermove", 3, 650, 400);
    await waitScale(page, a.scale * 2);
    await pointer(page, "pointerup", 2, 550, 400);
    await pointer(page, "pointerup", 3, 650, 400);
    await expect(globe(page)).toHaveAttribute("data-interacting", "false");
    expect(
      await globe(page).evaluate((el) => {
        const e = new Event("gesturestart", { cancelable: true });
        el.dispatchEvent(e);
        return e.defaultPrevented;
      }),
    ).toBe(true);
    expect(
      await globe(page).evaluate((el) => getComputedStyle(el).touchAction),
    ).toBe("none");
  });
  test("real Chromium multi-touch input through CDP preserves scale across separate pinches", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "CDP touch injection is Chromium-specific",
    );
    await page.goto(url);
    await ready(page);
    const a = await state(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });
    const send = (type, points) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map(([id, x, y]) => ({ id, x, y })),
      });
    await send("touchStart", [
      [1, 400, 400],
      [2, 500, 400],
    ]);
    await send("touchMove", [
      [1, 350, 400],
      [2, 550, 400],
    ]);
    await waitScale(page, a.scale * 2);
    await send("touchEnd", []);
    await expect(globe(page)).toHaveAttribute("data-interacting", "false");
    await send("touchStart", [
      [3, 400, 400],
      [4, 500, 400],
    ]);
    await send("touchMove", [
      [3, 425, 400],
      [4, 475, 400],
    ]);
    await waitScale(page, a.scale);
    await send("touchEnd", []);
    await cdp.detach();
  });
  test("resize preserves relative zoom and rotation", async ({ page }) => {
    await page.goto(url);
    await ready(page);
    await page.mouse.move(500, 400);
    await page.mouse.wheel(0, -400);
    await expect
      .poll(async () => (await state(page)).scale / (await state(page)).initial)
      .toBeGreaterThan(1.5);
    const a = await state(page);
    await page.setViewportSize({ width: 390, height: 740 });
    await expect
      .poll(async () => (await state(page)).initial)
      .toBeLessThan(a.initial);
    const b = await state(page);
    near(b.scale / b.initial, a.scale / a.initial);
    expect(b.rotation).toEqual(a.rotation);
  });
  test("manual levels preserve the fixture and return full detail; original toggle draws equivalent pixels", async ({
    page,
  }) => {
    await page.goto(url);
    await ready(page);
    await manual(page, 0);
    const a = await state(page);
    expect(a.level).toBe(MIN_AUTO_LEVEL);
    // At the production LOD floor this small topology-safe fixture may already
    // be at full detail. The real-atlas tests below require strict reduction.
    expect(a.vertices).toBeGreaterThan(0);
    expect(a.vertices).toBeLessThanOrEqual(a.source);
    await manual(page, 19);
    const b = await state(page);
    expect(b.vertices).toBe(b.source);
    await compareFullPixels(page, "controlled fixture");
  });
  test("fractional target LOD values select partial BLG levels with auto detail", async ({
    page,
  }) => {
    await page.goto(url);
    await ready(page);
    const auto = Number(await page.locator("#level").inputValue());
    expect(auto).toBeGreaterThanOrEqual(4);
    expect(Math.abs(auto * 10 - Math.round(auto * 10))).toBeLessThan(1e-6);
    await expect(page.locator("#auto")).toHaveCount(0);
    await expect(page.locator("#level")).toBeEnabled();
    await openSettings(page);
    await page.locator("#level").fill("7.3");
    await ready(page);
    await expect(page.locator("#level")).toHaveValue("7.3");
    await expect(page.locator("#level-value")).toHaveText("7.3");
    await expect(globe(page)).toHaveAttribute("data-rendered-level", "7.3");
  });
  test("zoom-out clamps actual requested and rendered LOD, then zoom-in resumes the curve", async ({
    page,
  }) => {
    await page.goto(url);
    await ready(page);
    await expect(globe(page)).toHaveAttribute("data-rendered-level", "4.2");
    await manual(page, 5);
    await atlasView(page, [0, -20, 0], 0.6);
    await expect(globe(page)).toHaveAttribute("data-target-level", "4.3");
    await expect(globe(page)).toHaveAttribute("data-rendered-level", "4.3");
    await openSettings(page);
    await page.locator("#level").fill("4");
    await ready(page);
    await expect(globe(page)).toHaveAttribute("data-target-level", "4.2");
    await expect(globe(page)).toHaveAttribute("data-rendered-level", "4.2");
    await atlasView(page, [0, -20, 0], 2);
    await expect(globe(page)).toHaveAttribute("data-target-level", "5");
    await expect(globe(page)).toHaveAttribute("data-rendered-level", "5");
  });
  test("level stays constant while dragging", async ({ page }) => {
    await page.goto(url);
    await ready(page);
    await manual(page, 12);
    await pointer(page, "pointerdown", 1, 400, 400);
    await expect(globe(page)).toHaveAttribute("data-interacting", "true");
    await expect(globe(page)).toHaveAttribute("data-rendered-level", "12");
    await pointer(page, "pointerup", 1, 400, 400);
    await expect(globe(page)).toHaveAttribute("data-interacting", "false");
    await ready(page);
    await expect(globe(page)).toHaveAttribute("data-rendered-level", "12");
  });
  test("default real atlas loads, reduces geometry and matches full-detail pixels across views", async ({
    page,
  }) => {
    test.slow();
    await page.goto(entry);
    await ready(page);
    await manual(page, 4);
    const a = await state(page);
    expect(a.source).toBeGreaterThan(1000);
    expect(a.vertices).toBeLessThan(a.source);
    await manual(page, 19);
    expect((await state(page)).vertices).toBeLessThanOrEqual(a.source);
    // Reuse the real atlas worker across views to avoid repeated preprocessing.
    for (const [name, rotation] of [
      ["Atlantic", [0, -20, 0]],
      ["Pacific / antimeridian", [180, 4, 0]],
      ["north polar", [0, 88, 0]],
      ["south polar", [0, -90, 0]],
    ])
      for (const zoom of [1, 3]) {
        const label = name + " at " + zoom + "x";
        await test.step(label, async () => {
          await atlasView(page, rotation, zoom);
          await compareFullPixels(page, label);
        });
      }
  });
  test("failed local file surfaces an error and fixture reload recovers", async ({
    page,
  }) => {
    await page.goto(url);
    await ready(page);
    await openSettings(page);
    await page.locator("#data-source summary").click();
    await page.locator("#file").setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });
    await expect(page.locator("#status")).toHaveAttribute(
      "data-phase",
      "error",
    );
    await page.locator("#atlas").selectOption("110m");
    await page.locator("#atlas").selectOption("fixture");
    await ready(page);
    expect((await state(page)).source).toBeGreaterThan(0);
  });
  test("wheel zoom-in and zoom-out update auto LOD monotonically without oscillating", async ({
    page,
  }) => {
    test.slow();
    await page.goto(entry + "?atlas=110m");
    await ready(page);
    const box = await globe(page).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const inLevels = [(await state(page)).level];
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, -180);
      await ready(page);
      inLevels.push((await state(page)).level);
    }
    for (let i = 1; i < inLevels.length; i++)
      expect(inLevels[i]).toBeGreaterThanOrEqual(inLevels[i - 1]);
    expect(inLevels.at(-1)).toBeGreaterThan(inLevels[0]);
    const outLevels = [inLevels.at(-1)];
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 180);
      await ready(page);
      outLevels.push((await state(page)).level);
    }
    for (let i = 1; i < outLevels.length; i++)
      expect(outLevels[i]).toBeLessThanOrEqual(outLevels[i - 1]);
    expect(outLevels.at(-1)).toBeLessThan(outLevels[0]);
  });
  test("opt-in bounding-cap culling matches unculled pixels across Atlantic, Pacific, and polar views", async ({
    page,
  }) => {
    await page.goto(entry);
    await ready(page);
    const mismatches = await page.evaluate(async () => {
      const [{ createGlobeRenderer }, { decodeCountries }] = await Promise.all([
        globalThis.globeDebug?.testModules?.map ??
          import("/examples/globe/map.mjs"),
        globalThis.globeDebug?.testModules?.geometry ??
          import("/examples/globe/geometry.mjs"),
      ]);
      const topo = await (
        await fetch(
          globalThis.globeDebug?.testModules
            ? new URL(
                "globe-data/test-atlas/countries-110m.json",
                location.href,
              ).href
            : "/node_modules/world-atlas/countries-110m.json",
        )
      ).json();
      const fc = decodeCountries(
        topo,
        globalThis.globeDebug?.testModules?.topojson ?? globalThis.topojson,
      );
      const width = 400,
        height = 300;
      const make = (cull) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        return {
          ctx,
          draw: createGlobeRenderer(
            globalThis.globeDebug?.testModules?.d3 ?? globalThis.d3,
            ctx,
            { cull },
          ),
        };
      };
      const a = make(false),
        b = make(true);
      const out = [];
      for (const [name, rotation] of [
        ["Atlantic", [0, -20, 0]],
        ["Pacific", [180, 4, 0]],
        ["NorthPole", [0, 88, 0]],
        ["SouthPole", [0, -92, 0]],
      ]) {
        for (const zoom of [1, 3]) {
          const st = {
            width,
            height,
            rotation,
            scale: 120 * zoom,
            translation: [width / 2, height / 2],
            interacting: false,
            dpr: 1,
          };
          a.draw(st, fc);
          b.draw(st, fc);
          const da = a.ctx.getImageData(0, 0, width, height).data,
            db = b.ctx.getImageData(0, 0, width, height).data;
          let diff = 0;
          for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) diff++;
          if (diff > 0) out.push({ name, zoom, diff });
        }
      }
      return out;
    });
    expect(mismatches).toEqual([]);
  });
  test("culling minimap renders in bottom-right box with pointer-events none and updates on zoom", async ({
    page,
  }) => {
    await page.goto(entry);
    await ready(page);
    const mini = page.locator("#minimap");
    await expect(mini).toBeVisible();
    await expect(mini).toHaveCSS("pointer-events", "none");
    const before = await mini.screenshot();
    expect(before.byteLength).toBeGreaterThan(200);
    const box = await globe(page).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -200);
    await ready(page);
    const after = await mini.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });
  test("view clipping matches unclipped pixels on 110m and 50m atlases at zoomed, polar and antimeridian views", async ({
    page,
  }) => {
    test.setTimeout(180000);
    await page.goto(entry + "?fixture=1");
    await ready(page);
    const result = await page.evaluate(async () => {
      const [{ createGlobeRenderer }, { decodeCountries }] = await Promise.all([
        globalThis.globeDebug?.testModules?.map ??
          import("/examples/globe/map.mjs"),
        globalThis.globeDebug?.testModules?.geometry ??
          import("/examples/globe/geometry.mjs"),
      ]);
      const width = 960,
        height = 540;
      const make = (opts) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        return {
          ctx,
          draw: createGlobeRenderer(
            globalThis.globeDebug?.testModules?.d3 ?? globalThis.d3,
            ctx,
            opts,
          ),
        };
      };
      const out = [];
      for (const [atlas, views] of [
        [
          "110m",
          [
            ["Europe", [-12, -48, 0], 12],
            ["Pacific", [180, -10, 0], 8],
            ["NorthPole", [0, -89, 0], 9],
            ["SouthPole", [0, 89, 0], 9],
            ["Mid", [-100, -45, 0], 7],
          ],
        ],
        [
          "50m",
          [
            ["Alps", [-10, -46.5, 0], 30],
            ["Fiji", [-178, 17, 0], 20],
            ["Canada", [100, -60, 0], 6],
            ["Africa", [-20, -2, 0], 8],
          ],
        ],
      ]) {
        const topo = await (
          await fetch(
            globalThis.globeDebug?.testModules
              ? new URL(
                  `globe-data/test-atlas/countries-${atlas}.json`,
                  location.href,
                ).href
              : `/node_modules/world-atlas/countries-${atlas}.json`,
          )
        ).json();
        const fc = decodeCountries(
          topo,
          globalThis.globeDebug?.testModules?.topojson ?? globalThis.topojson,
        );
        const cull = make({ cull: true }),
          clip = make({ cull: true, clip: true });
        for (const [name, rotation, zoom] of views) {
          const state = {
            width,
            height,
            rotation,
            scale: 100 * zoom,
            translation: [width / 2, height / 2],
            interacting: false,
            dpr: 1,
          };
          cull.draw(state, fc);
          const { stats } = clip.draw(state, fc);
          const a = cull.ctx.getImageData(0, 0, width, height).data,
            b = clip.ctx.getImageData(0, 0, width, height).data;
          let big = 0,
            any = 0;
          for (let i = 0; i < a.length; i += 4) {
            const d = Math.max(
              Math.abs(a[i] - b[i]),
              Math.abs(a[i + 1] - b[i + 1]),
              Math.abs(a[i + 2] - b[i + 2]),
            );
            if (d > 0) any++;
            if (d > 32) big++;
          }
          out.push({
            atlas,
            name,
            big,
            any,
            mode: stats.mode,
            vertices: stats.vertices,
            sourceVertices: stats.sourceVertices,
          });
        }
      }
      return out;
    });
    console.log(JSON.stringify(result));
    for (const r of result) {
      // Resampling of shortened great-circle edges may shift antialiasing, but
      // no visible shape may differ.
      expect(r.big, `${r.atlas} ${r.name}`).toBeLessThanOrEqual(8);
      if (r.mode === "clip")
        expect(r.vertices, `${r.atlas} ${r.name}`).toBeLessThan(
          r.sourceVertices,
        );
    }
    expect(result.filter((r) => r.mode === "clip").length).toBe(result.length);
  });
  test("live globe clips geometry when zoomed, reports stats, and ?clip=0 disables it", async ({
    page,
  }, testInfo) => {
    test.slow();
    const zoomIn = async () => {
      await ready(page);
      const box = await globe(page).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 14; i++) await page.mouse.wheel(0, -300);
      await ready(page);
      await expect(globe(page)).toHaveAttribute("data-draw-mode", /clip|cull/);
    };
    await page.goto(entry);
    await zoomIn();
    await expect(globe(page)).toHaveAttribute("data-draw-mode", "clip");
    const clipped = await globe(page).evaluate((el) => ({
      drawn: Number(el.dataset.drawnVertices),
      source: Number(el.dataset.vertices),
    }));
    expect(clipped.drawn).toBeGreaterThan(0);
    expect(clipped.drawn).toBeLessThan(clipped.source);
    await openSettings(page);
    await page.getByText("Diagnostics", { exact: true }).click();
    await expect(page.locator("#diagnostics")).toContainText(
      /Drawn: \d+ \/ \d+ vertices/,
    );
    await page.screenshot({
      path: testInfo.outputPath("clip-on.png"),
    });
    await testInfo.attach("clip-on", {
      path: testInfo.outputPath("clip-on.png"),
      contentType: "image/png",
    });

    await page.goto(entry + "?clip=0&atlas=110m");
    // Cull-only draws every visible vertex each frame; the 50m default is too
    // heavy for a software-GL screenshot and the draw mode ignores the atlas.
    await zoomIn();
    await expect(globe(page)).toHaveAttribute("data-draw-mode", "cull-only");
    await page.screenshot({ path: testInfo.outputPath("clip-off.png") });
  });
  test("the tree hides collapsed polygons at coarse levels and restores them at full detail", async ({
    page,
  }) => {
    const read = () =>
      globe(page).evaluate((el) => ({
        hidden: Number(el.dataset.hiddenPolygons),
        vertices: Number(el.dataset.vertices),
      }));
    await page.goto(entry + "?atlas=110m");
    await ready(page);
    await manual(page, 4);
    const coarse = await read();
    expect(coarse.hidden).toBeGreaterThan(0);
    await manual(page, 19);
    const full = await read();
    expect(full.hidden).toBe(0);
    expect(coarse.vertices).toBeLessThan(full.vertices);
    expect(await page.locator("#min-px").count()).toBe(0);
  });

  test("wheel zoom follows a spring target, then reset converges", async ({
    page,
  }) => {
    await page.goto(entry + "?fixture=1&smooth=1");
    await ready(page);
    const d = (key) => globe(page).evaluate((el, k) => el.dataset[k], key);
    await page.locator("#nav-response").evaluate((el) => {
      el.value = "1500";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const a = await state(page);
    await page.mouse.wheel(0, -600);
    await expect.poll(() => d("goalScale")).not.toBe(String(a.scale));
    const goal = Number(await d("goalScale"));
    expect(goal).toBeGreaterThan(a.scale);
    expect((await state(page)).scale).toBeLessThan(goal);
    expect(await d("moving")).toBe("true");
    await expect.poll(() => d("moving"), { timeout: 15000 }).toBe("false");
    near((await state(page)).scale, goal);
    await page.locator("#reset").click();
    // The previous idle frame can still be published immediately after click.
    // Require the reset pose and settled flag from the same rendered frame.
    await expect
      .poll(
        () =>
          globe(page).evaluate((el) => ({
            moving: el.dataset.moving,
            scale:
              Math.abs(
                Number(el.dataset.scale) - Number(el.dataset.initialScale),
              ) < 0.001,
          })),
        { timeout: 15000 },
      )
      .toEqual({ moving: "false", scale: true });
    near((await state(page)).scale, a.initial);
    await ready(page);
    const frames = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let n = 0;
          const count = () => n++;
          const orig = window.requestAnimationFrame;
          window.requestAnimationFrame = (f) => (count(), orig(f));
          setTimeout(() => resolve(n), 300);
        }),
    );
    expect(frames).toBe(0);
  });

  const flightUrl = entry + "?fixture=1&smooth=1";
  const data = (page, key) =>
    globe(page).evaluate((el, k) => el.dataset[k], key);
  test("holding D accelerates zoom in, release coasts, C flies back out, then frames stop", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        "quadstream-globe-nav",
        '{"smooth":true,"flyZoom":0.25}',
      ),
    );
    await page.goto(flightUrl);
    await ready(page);
    const a = await state(page);
    await page.keyboard.down("KeyD");
    await page.waitForTimeout(150);
    const mid = await state(page);
    expect(mid.scale).toBeGreaterThan(a.scale);
    await page.keyboard.up("KeyD");
    const released = (await state(page)).scale;
    // Viscous drag carries the camera a little further after release.
    await expect
      .poll(async () => (await state(page)).scale, { timeout: 3000 })
      .toBeGreaterThan(released);
    await page.waitForTimeout(800);
    await expect
      .poll(() => data(page, "thrusting"), { timeout: 15000 })
      .toBe("false");
    await expect.poll(() => data(page, "moving")).toBe("false");
    const settled = (await state(page)).scale;
    await page.keyboard.down("KeyC");
    await page.waitForTimeout(600);
    await page.keyboard.up("KeyC");
    expect((await state(page)).scale).toBeLessThan(settled);
    await expect
      .poll(() => data(page, "moving"), { timeout: 15000 })
      .toBe("false");
    await ready(page);
    const frames = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let n = 0;
          const raf = window.requestAnimationFrame;
          window.requestAnimationFrame = (f) => (n++, raf(f));
          setTimeout(() => resolve(n), 300);
        }),
    );
    expect(frames).toBe(0);
  });
  test("arrow thrust moves camera, space brakes, blur releases keys, R resets", async ({
    page,
  }) => {
    await page.goto(flightUrl);
    await ready(page);
    const a = await state(page);
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(300);
    expect((await state(page)).rotation[1]).toBeLessThan(a.rotation[1]);
    await page.keyboard.press("Space");
    await expect
      .poll(() => data(page, "moving"), { timeout: 3000 })
      .toBe("false");
    const stopped = (await state(page)).rotation[1];
    await page.waitForTimeout(200);
    expect((await state(page)).rotation[1]).toBe(stopped);
    await page.keyboard.down("ArrowLeft");
    await expect.poll(() => data(page, "thrusting")).toBe("true");
    await expect
      .poll(async () => (await state(page)).rotation[0])
      .toBeGreaterThan(a.rotation[0]);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect
      .poll(() => data(page, "thrusting"), { timeout: 15000 })
      .toBe("false");
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.press("KeyR");
    // Diagnostics are published by render(), not the key handler. The previous
    // idle frame can still report moving=false before the reset has drawn.
    // Require the reset pose and idle flags in the same rendered frame.
    await expect
      .poll(
        () =>
          globe(page).evaluate((el) => {
            const d = el.dataset;
            const [lon, lat, roll] = JSON.parse(d.rotation);
            return {
              moving: d.moving,
              thrusting: d.thrusting,
              rotation: [
                Math.abs(((((lon + 180) % 360) + 360) % 360) - 180) < 0.001,
                Math.abs(lat + 20) < 0.001,
                Math.abs(roll) < 0.001,
              ],
              scale: Math.abs(Number(d.scale) - Number(d.initialScale)) < 0.001,
            };
          }),
        { timeout: 15000 },
      )
      .toEqual({
        moving: "false",
        thrusting: "false",
        rotation: [true, true, true],
        scale: true,
      });
  });
  test("holding D traverses LOD without a request storm", async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        "quadstream-globe-nav",
        '{"smooth":true,"flyZoom":0.25}',
      ),
    );
    await page.goto(flightUrl);
    await ready(page);
    const before = (await state(page)).requests;
    await page.keyboard.down("KeyD");
    await page.waitForTimeout(1200);
    await page.keyboard.up("KeyD");
    await expect
      .poll(() => data(page, "moving"), { timeout: 15000 })
      .toBe("false");
    const s = await state(page);
    // Quantized to 0.1 level steps: requests are bounded by the level range.
    expect(s.requests - before).toBeLessThan(200);
  });

  // Introduce response latency independent of machine speed. The actual worker
  // and geometry are unchanged; a moving camera must still publish results.
  test("slow geometry keeps refining during sustained zoom and reversal", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "quadstream-globe-nav",
        '{"smooth":true,"flyZoom":1}',
      );
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          super(url, options);
          if (
            !String(url).endsWith("/worker.mjs") &&
            options?.name !== "quadstream-geometry"
          )
            return;
          const replayed = new WeakSet();
          this.addEventListener("message", (event) => {
            if (!event.data.frame || replayed.has(event)) return;
            event.stopImmediatePropagation();
            setTimeout(() => {
              const reply = new MessageEvent("message", { data: event.data });
              replayed.add(reply);
              this.dispatchEvent(reply);
            }, 250);
          });
        }
      };
    });
    await page.goto(flightUrl);
    await ready(page);
    const initial = (await state(page)).level;
    await page.keyboard.down("KeyD");
    let first, second;
    try {
      await expect
        .poll(async () => (await state(page)).level, { timeout: 10000 })
        .toBeGreaterThan(initial);
      first = (await state(page)).level;
      await expect
        .poll(async () => (await state(page)).level, { timeout: 10000 })
        .toBeGreaterThan(first);
      second = (await state(page)).level;
      expect(await data(page, "thrusting")).toBe("true");
    } finally {
      await page.keyboard.up("KeyD");
    }

    await page.keyboard.down("KeyC");
    try {
      await expect
        .poll(async () => (await state(page)).level, { timeout: 10000 })
        .toBeLessThan(second);
      expect(await data(page, "thrusting")).toBe("true");
    } finally {
      await page.keyboard.up("KeyC");
    }
    await expect
      .poll(() => data(page, "moving"), { timeout: 15000 })
      .toBe("false");
    await ready(page);
    expect(await data(page, "renderedLevel")).toBe(
      await data(page, "targetLevel"),
    );
  });

  test("settings disclosure preserves controls and globe layout", async ({
    page,
  }, testInfo) => {
    await page.goto(url);
    await ready(page);
    const panel = page.locator("#panel");
    const toggle = page.locator("#settings-toggle");
    await expect(panel).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const bounds = await globe(page).boundingBox();
    await openSettings(page);
    await expect(panel).toBeVisible();
    expect((await panel.boundingBox()).width).toBeLessThanOrEqual(360);
    expect(await globe(page).boundingBox()).toEqual(bounds);
    await page.locator("#show-quadtree").check();
    await page.locator("#navigation summary").click();
    await page.locator("#data-source summary").click();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(toggle).toBeFocused();
    await openSettings(page);
    await expect(page.locator("#show-quadtree")).toBeChecked();
    await expect(page.locator("#navigation")).toHaveAttribute("open", "");
    await expect(page.locator("#data-source")).toHaveAttribute("open", "");
    await page.screenshot({
      path: testInfo.outputPath("settings-desktop.png"),
    });
    await page.mouse.click(800, 400);
    await expect(panel).toBeHidden();
    await page.locator("#minimap-toggle").click();
    await expect(page.locator("#minimap")).toBeHidden();
    await expect(page.locator("#minimap-toggle")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await page.locator("#minimap-toggle").click();
    await expect(page.locator("#minimap")).toBeVisible();
    await page.locator("#reset").click();
  });

  test("mobile settings fit and diagnostics remain discoverable", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(url);
    await ready(page);
    await openSettings(page);
    await page.locator("#data-source summary").click();
    await page.locator("#file").setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from("invalid"),
    });
    await expect(page.locator("#status")).toHaveAttribute(
      "data-phase",
      "error",
    );
    await page.keyboard.press("Escape");
    await expect(page.locator("#panel")).toBeHidden();
    await expect(page.locator("#status-indicator")).toHaveAttribute(
      "data-kind",
      "error",
    );
    await page.locator("#status-indicator").click();
    await expect(page.locator("#diagnostics-section")).toHaveAttribute(
      "open",
      "",
    );
    await expect(page.locator("#retry")).toBeVisible();
    const bounds = await page.locator("#panel").boundingBox();
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(667);
    await page.screenshot({ path: testInfo.outputPath("settings-mobile.png") });
  });

  test("drag and wheel settle to the geographic anchor with smoothing enabled", async ({
    page,
  }) => {
    await page.goto(entry + "?fixture=1&smooth=1");
    await ready(page);
    const box = await globe(page).boundingBox();
    const x = box.x + box.width / 2 + 35;
    const y = box.y + box.height / 2 + 25;
    const anchor = await globe(page).evaluate(
      (el, [x, y]) => {
        const rect = el.getBoundingClientRect();
        return (globalThis.globeDebug?.testModules?.d3 ?? globalThis.d3)
          .geoOrthographic()
          .rotate(JSON.parse(el.dataset.rotation))
          .scale(Number(el.dataset.scale))
          .translate([el.clientWidth / 2, el.clientHeight / 2])
          .invert([x - rect.left, y - rect.top]);
      },
      [x, y],
    );
    const error = (x, y, goal = false) =>
      globe(page).evaluate(
        (el, { anchor, x, y, goal }) => {
          const rect = el.getBoundingClientRect();
          const p = (globalThis.globeDebug?.testModules?.d3 ?? globalThis.d3)
            .geoOrthographic()
            .rotate(
              JSON.parse(goal ? el.dataset.goalRotation : el.dataset.rotation),
            )
            .scale(Number(goal ? el.dataset.goalScale : el.dataset.scale))
            .translate([el.clientWidth / 2, el.clientHeight / 2])(anchor);
          return Math.hypot(p[0] + rect.left - x, p[1] + rect.top - y);
        },
        { anchor, x, y, goal },
      );
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 50, y + 30);
    await page.mouse.move(x - 20, y - 10);
    await page.mouse.move(x + 50, y + 30);
    await expect.poll(() => error(x + 50, y + 30, true)).toBeLessThan(0.5);
    await page.mouse.up();
    await expect
      .poll(() => data(page, "moving"), { timeout: 15000 })
      .toBe("false");
    await expect.poll(() => error(x + 50, y + 30)).toBeLessThan(0.5);
    await page.mouse.wheel(0, -300);
    await page.mouse.wheel(0, -300);
    await expect.poll(() => error(x + 50, y + 30, true)).toBeLessThan(0.5);
    await expect
      .poll(() => data(page, "moving"), { timeout: 15000 })
      .toBe("false");
    expect((await state(page)).scale).toBeGreaterThan(
      (await state(page)).initial,
    );
    await expect.poll(() => error(x + 50, y + 30)).toBeLessThan(0.5);
    expect((await state(page)).rotation[2]).toBe(0);
  });
}
