# Quadstream Globe (React/Vite migration)

Parallel implementation only; the root library and legacy globe remain authoritative.
The migration plan is [here](../plans/REACT_VITE_DEMO.md).

Use Node 26 for the app (the library retains its own Node support).
Install and build the root package first (`npm --prefix .. ci` and `npm --prefix .. run build` from this directory), then run `npm ci` in this directory. The app uses the root-pinned D3, TopoJSON, atlas data, and compiled geometry library.

- `npm run dev` — isolated Vite development server.
- `npm run check` — typecheck, lint, and unit tests with Node coverage.
- `npm run test:browser` — build and test the production app under /migration/.
- `npm run test:baseline` — legacy fixture capture with screenshots and JSON.
  Requires root dependencies installed and `npm --prefix .. run build` first.
  Install Chromium and WebKit via `npx playwright install` if not already available.

The dedicated workflow uses Node 26 and the matching Playwright browser image.
During the one-time lockfile bootstrap it publishes the generated app lockfile;
commit that exact file before merging, then installs use npm ci.

## Baseline methodology

The baseline uses a fixed 1100 × 850 viewport, DPR 1, local fixture, disabled
navigation smoothing, and a shared deterministic camera trace. It records the
settled camera and geometry diagnostics and canvas images for four views.
Results are per-run artifacts, not yet accepted golden snapshots. The startup
and observed convergence values include browser automation overhead and are
diagnostic, not frame-time or promotion gates.

For parity and performance in later phases, run legacy and React with the same
browser build, hardware, fixtures, camera trace, viewport and fonts; retain
raw timings and repeat runs to measure noise. Add instrumentation for actual
frame time, input-to-frame latency, idle draws, worker and memory metrics, and
label-off/on comparisons before asserting the plan's proposed thresholds.
The React app now mounts the legacy globe algorithms through a lifecycle adapter and uses ESM imports and Vite module workers. Both apps register the same 25 browser scenarios from `test/browser/globe-suite.mjs`; the Vite suite tests the production build under `/migration/` in Chromium and WebKit. The legacy entry point and core runtime are unchanged. City labels, full comparative benchmarks, and promotion remain subsequent phases. The regional catalog currently contains no international records; the app retains catalog support and US layers.

## GitHub Pages deployment

The public React globe is intended to be hosted at
<https://vizhub-studio.github.io/quadstream/>. In the repository's Settings →
Pages, select GitHub Actions as the publishing source (one-time setup).
The `globe-pages.yml` workflow builds the root library and this app using the
committed lockfiles, with Vite base `/quadstream/`. It smoke-tests the actual
production output under that path in Chromium and WebKit before uploading only
`quadstream-globe/dist` to Pages. Pull requests build and test without publishing;
updates to `main` publish automatically, and the workflow can also be dispatched
manually from `main`. The legacy globe remains available locally and unchanged.

To reproduce the Pages build from this directory after installing dependencies:

```sh
npm run build -- --base=/quadstream/
GLOBE_BASE_PATH=/quadstream/ npx playwright test --config playwright.config.mjs scaffold.spec.mjs
```

The default browser parity suite continues to use `/migration/`.
