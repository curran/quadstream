import { test, expect } from "@playwright/test";
const url = "/examples/globe/index.html?fixture=1";
const globe = (page) => page.locator("#globe");
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
        Math.abs(
          Number(d.renderedLevel) -
            Number(document.querySelector("#level").value),
        ) < 0.001 &&
        !!d.rotation &&
        Number(d.scale) > 0 &&
        Number(d.requests) > 0 &&
        Number(d.sourceVertices) > 0 &&
        Number(d.vertices) > 0
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
  await page.locator("#auto").uncheck();
  await page.locator("#level").evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, level);
  await ready(page);
  await expect(globe(page)).toHaveAttribute(
    "data-rendered-level",
    String(level),
  );
}
// Compare within one browser, at an identical idle camera and full LOD.
async function compareFullPixels(page, label) {
  await ready(page);
  await expect(globe(page)).toHaveAttribute("data-interacting", "false");
  const before = await state(page);
  expect(before.level).toBe(19);
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
// Drive the same public keyboard and wheel event handlers as a user.
// Each camera starts from Reset; wheel zoom is exponential and bounded.
async function atlasView(page, rotation, zoom) {
  await page.locator("#reset").click();
  await globe(page).evaluate(
    (el, { rotation, zoom }) => {
      const press = (key, n) => {
        for (let i = 0; i < n; i++)
          el.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              bubbles: true,
              cancelable: true,
            }),
          );
      };
      const x = rotation[0] / 12,
        y = (rotation[1] + 20) / 12;
      press(x < 0 ? "ArrowLeft" : "ArrowRight", Math.abs(x));
      press(y < 0 ? "ArrowUp" : "ArrowDown", Math.abs(y));
      if (zoom !== 1)
        el.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: -Math.log(zoom) / 0.0015,
            bubbles: true,
            cancelable: true,
          }),
        );
    },
    { rotation, zoom },
  );
  await expect.poll(async () => (await state(page)).rotation).toEqual(rotation);
  await expect
    .poll(async () =>
      Math.abs((await state(page)).scale / (await state(page)).initial - zoom),
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
  await globe(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await state(page)).rotation[0])
    .toBeGreaterThan(b.rotation[0]);
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
  expect((await state(page)).rotation).toEqual(a.rotation);
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
test("manual levels reduce geometry and return full detail; original toggle draws equivalent pixels", async ({
  page,
}) => {
  await page.goto(url);
  await ready(page);
  await manual(page, 0);
  const a = await state(page);
  expect(a.vertices).toBeLessThan(a.source);
  await manual(page, 19);
  const b = await state(page);
  expect(b.vertices).toBe(b.source);
  await compareFullPixels(page, "controlled fixture");
});
test("fractional manual LOD values select partial BLG levels", async ({
  page,
}) => {
  await page.goto(url);
  await ready(page);
  const auto = Number(await page.locator("#level").inputValue());
  expect(auto).toBeGreaterThanOrEqual(4);
  expect(Math.abs(auto * 10 - Math.round(auto * 10))).toBeLessThan(1e-6);
  await page.locator("#auto").uncheck();
  await page.locator("#level").fill("7.3");
  await ready(page);
  await expect(page.locator("#level")).toHaveValue("7.3");
  await expect(page.locator("#level-value")).toHaveText("7.3");
  await expect(globe(page)).toHaveAttribute("data-rendered-level", "7.3");
});
test("default real atlas loads, reduces geometry and matches full-detail pixels across views", async ({
  page,
}) => {
  await page.goto("/examples/globe/index.html");
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
    ["south polar", [0, -92, 0]],
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
  await page.locator("#file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await expect(page.locator("#status")).toHaveAttribute("data-phase", "error");
  await page.locator("#atlas").selectOption("110m");
  await page.locator("#atlas").selectOption("fixture");
  await ready(page);
  expect((await state(page)).source).toBeGreaterThan(0);
});
test("wheel zoom-in and zoom-out update auto LOD monotonically without oscillating", async ({
  page,
}) => {
  await page.goto("/examples/globe/index.html");
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
  await page.goto("/examples/globe/index.html");
  await ready(page);
  const mismatches = await page.evaluate(async () => {
    const [{ createGlobeRenderer }, { decodeCountries }] = await Promise.all([
      import("/examples/globe/map.mjs"),
      import("/examples/globe/geometry.mjs"),
    ]);
    const topo = await (
      await fetch("/node_modules/world-atlas/countries-110m.json")
    ).json();
    const fc = decodeCountries(topo, globalThis.topojson);
    const width = 400,
      height = 300;
    const make = (cull) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      return { ctx, draw: createGlobeRenderer(globalThis.d3, ctx, { cull }) };
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
  await page.goto("/examples/globe/index.html");
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
