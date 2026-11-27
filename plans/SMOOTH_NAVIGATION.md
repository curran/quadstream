# Smooth Pan/Zoom ("Spaceship" Navigation)

## Goal

Gestures set a **goal state**; the view is a **mass** pulled toward it by a
spring-like force with viscous damping. Motion should feel buttery, inertial,
and scale-aware at every zoom level. Scope: the globe example
(`examples/globe`). Each tunable gets a dedicated slider styled like LOD.

## Current state

- `interaction.mjs` (`createGlobeInteraction`) applies pointer/wheel deltas
  directly via `update({rotation | scale})`; `main.mjs` `update()` mutates
  `state` and calls `schedule()` (rAF redraw only on demand) and
  `requestLevel()` on scale change.
- Pan factor `k = 58 * (min(w,h)/600) / scale` already makes drag
  scale-aware. Zoom is multiplicative (`exp(-delta*0.0015)`), clamped to
  `[0.6, 64] × initialScale`.
- Keyboard arrows/±, reset, and resize also write `state` directly.
- LOD slider: `#level` in `index.html` (`.lod-row`) with `#level-value`
  output and an `input` listener in `main.mjs`.
- Tests: `test/globe-interaction.test.mjs` (unit, injectable timers) and
  `test/browser/globe.spec.mjs` (reads `canvas.dataset.rotation/scale`).

## Design

### 1. Separate goal from rendered state

- `goal = { rotation, scale }` — written by all input paths.
- `state.rotation/scale` — the rendered, physically simulated values.
- Interaction controller's `update()` targets `goal`; its `getState` baselines
  (pinch rebase, pan `k`) must read the **goal** so gestures stay 1:1 with the
  pointer's intent and don't compound lag.

### 2. New module `examples/globe/physics.mjs` (pure, unit-testable)

`createSpring({ params, now })` with `step(dt)` and
`setGoal/snap/isSettled`. Per-channel damped-spring integrator:

```
a = (stiffness * (goal - x) - damping * v) / mass
```

- Integrate with **semi-implicit Euler at a fixed sub-step (e.g. 1/240 s)**
  with an accumulator, or the closed-form critically-damped solution, so
  results are frame-rate independent and stable for large `dt` (clamp frame
  `dt` to ~50 ms after tab-resume).
- **Zoom is simulated in log space**: `z = ln(scale / initialScale)`.
  Equal force gives equal perceived zoom speed at every depth, and avoids
  overshoot to near-zero/negative scale.
- **Pan is simulated as an angular delta on the sphere**, not raw
  `rotation[0..1]` lerp: operate on the rotation difference (wrap longitude
  via shortest path, ±180°; clamp latitude to ±90°). Goal distance is in
  degrees, so the spring is naturally scale-independent; pointer-to-goal
  mapping already divides by `scale`, so deep zoom moves tiny angles and
  stays smooth.
- Optional coupling: scale pan stiffness by zoom so very deep zoom doesn't
  feel sluggish (`stiffness_eff = stiffness * (1 + c*z)`), behind no extra
  slider initially.
- **Settle epsilon**: stop the loop when |goal−x| and |v| are below
  thresholds (angular ~1e-4° scaled by 1/scale; log-zoom ~1e-4). Snap to goal
  and stop requesting frames.
- Clamp goal zoom, not just rendered zoom; apply a soft wall on rendered
  zoom so inertia can't overshoot the limits.

### 3. Animation loop in `main.mjs`

- Replace "schedule on update" with: `update()` sets goal and calls
  `startMotion()`. A single rAF loop computes real `dt` from the rAF
  timestamp, steps the springs, writes `state`, draws, and continues only
  while not settled or interacting. Keep `schedule()` for non-motion redraws.
- Slider `0` smoothness ⇒ bypass physics (direct set), preserving today's
  behaviour and existing tests.
- During active drag, optionally let the goal follow the pointer exactly
  while the mass trails (core "momentum" feel); on release the spring keeps
  carrying velocity. Optional later: seed release velocity from the recent
  pointer velocity for fling.
- `reset`, keyboard arrows, ±: set goal (animated flight). Resize: `snap`
  both goal and state (rebase scale to the new `initialScale`).
- Pinch/wheel: zoom about the view centre (current behaviour); anchor-point
  zoom is out of scope.

### 4. Level-of-detail interplay

- `requestLevel()` currently fires on every scale update. With animation it
  must key off the **rendered** scale per frame, but throttled/quantized
  (it already uses `quantizeAutoLevel`; only re-select when the level
  changes, which the existing `latest.target !== level` check handles).
- Consider driving LOD from the **goal** scale while motion is large so
  geometry is fetched ahead of the camera, avoiding pop-in at the end of a
  fast zoom. Decide via trace after implementing.
- `state.interacting` should remain true while the view is still moving (not
  only while pointers are down) so the renderer keeps any "interacting"
  cheap-path behaviour. Verify what `interacting` gates in `map.mjs`/
  `clip.mjs` before changing.

### 5. UI: sliders (same markup as `.lod-row`)

Add a "Navigation" group below the LOD row, reusing `.lod-row`,
`<label>`, `<input type="range">`, `<output>`:

| Slider      | id             | Range (suggested) | Default | Meaning                    |
| ----------- | -------------- | ----------------- | ------- | -------------------------- |
| Smoothness  | `smoothness`   | 0–1, step 0.01    | 0.6     | Master macro; 0 = off      |
| Mass        | `nav-mass`     | 0.2–5, step 0.1   | 1       | Inertia                    |
| Force       | `nav-force`    | 1–100, step 1     | 30      | Spring stiffness           |
| Damping     | `nav-damping`  | 0–2 (ζ ratio)     | 1.0     | Viscosity; <1 overshoot    |

- Express damping as a **damping ratio ζ** (`c = 2ζ√(k·m)`) so 1.0 is always
  critically damped regardless of mass/force; the slider is intuitive and
  can't easily produce unstable settings.
- `Smoothness` is a macro that scales effective stiffness/damping from the
  base values (0 disables physics); the individual sliders remain for
  tuning. Persist values in `localStorage` and optionally URL params
  (existing code already reads `location.search`).
- Expose values in `canvas.dataset` (`navMass`, `navForce`, `navDamping`,
  `moving`, `goalScale`, `goalRotation`) for deterministic browser tests.
- Update `aria-label` on the canvas if behaviour descriptions change; add
  `docs/GLOBE.md` section describing the model and sliders; add a
  `CHANGELOG.md` entry.

## Implementation steps

1. `physics.mjs` spring + unit tests (convergence, no overshoot at ζ≥1,
   overshoot at ζ<1, frame-rate independence at 30/60/144 Hz, large-`dt`
   stability, longitude wrap, settle detection).
2. Split goal/state in `main.mjs`; point the interaction controller at goal;
   add the rAF motion loop and settle logic; keep smoothness 0 ≡ legacy.
3. Route keyboard, reset, resize through goal/snap.
4. Add sliders + persistence + dataset exposure.
5. LOD coupling decision (rendered vs. goal scale) using
   `scripts/profile-globe-browser.mjs`; ensure no request storm during
   continuous zoom.
6. Update `test/globe-interaction.test.mjs` (goal semantics),
   `test/browser/globe.spec.mjs` (wait for `data-moving="false"` before
   asserting final rotation/scale; assert intermediate frames are monotonic
   toward goal).
7. Docs/CHANGELOG; run `npm test` + lint + Playwright suite.

## Risks / open questions

- **Frame time**: clip/cull draw cost at high LOD may exceed 16 ms; the
  fixed-step integrator keeps motion correct but the draw is the bottleneck.
  Consider reduced-quality draw while `moving` (already a pattern with
  `interacting`).
- **Latitude/pole singularities** with rotation-space springs; mitigated by
  simulating angular deltas and clamping latitude.
- **Existing tests** assert immediate state changes; they need a smoothness-0
  path or settle-waits.
- **Reduced motion**: honour `prefers-reduced-motion` by defaulting
  smoothness to 0.
- Do we want fling-on-release velocity and anchor-point (cursor) zoom? Both
  proposed as follow-ups, not part of this scope.

## Acceptance criteria

- With defaults, drag/wheel/pinch/keys produce continuous motion that
  converges to the goal with no jitter, and stops rendering when settled.
- Behaviour is visually equivalent in feel at 1× and 64× zoom (log-space
  zoom, scale-aware pan).
- Each slider changes feel live; smoothness 0 reproduces current behaviour.
- Motion is identical across 30/60/144 Hz in unit simulation.
- No LOD request storms; no pop-in at settle beyond today's behaviour.
