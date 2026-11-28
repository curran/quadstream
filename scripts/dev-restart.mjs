// Restarts the globe dev server: stops whatever is listening on the PORT,
// then starts `npm run dev` detached and waits for it to respond.
// Usage: npm run dev:restart  (PORT env overrides the default 4173)
import { execFileSync, spawn } from "node:child_process";
import { openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = String(process.env.PORT ?? 4173);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const log = join(tmpdir(), "quadstream-dev.log");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listeners() {
  const pids = new Set();
  try {
    const out = execFileSync("ss", ["-ltnpH", `sport = :${port}`], {
      encoding: "utf8",
    });
    for (const m of out.matchAll(/pid=(\d+)/g)) pids.add(Number(m[1]));
  } catch {
    // ss unavailable: fall back to lsof.
    try {
      const out = execFileSync("lsof", ["-ti", `tcp:${port}`], {
        encoding: "utf8",
      });
      for (const line of out.split("\n"))
        if (line.trim()) pids.add(Number(line));
    } catch {
      // Nothing listening (lsof exits non-zero when no match).
    }
  }
  return [...pids];
}

for (const pid of listeners()) {
  try {
    process.kill(pid, "SIGTERM");
    console.log(`stopped pid ${pid}`);
  } catch (e) {
    console.warn(`could not stop pid ${pid}: ${e.message}`);
  }
}
// Give listeners a moment to release the port, then force any stragglers.
for (let i = 0; i < 20 && listeners().length; i++) await sleep(100);
for (const pid of listeners()) {
  try {
    process.kill(pid, "SIGKILL");
    console.log(`force-killed pid ${pid}`);
  } catch {
    // Already gone between the check and the kill.
  }
}

const out = openSync(log, "a");
const child = spawn(npm, ["run", "dev"], {
  cwd: root,
  env: process.env,
  detached: true,
  stdio: ["ignore", out, out],
});
child.unref();
console.log(`starting dev server on port ${port} (log: ${log})`);

const url = `http://127.0.0.1:${port}/`;
for (let i = 0; i < 60; i++) {
  await sleep(500);
  try {
    const code = execFileSync(
      "curl",
      ["-s", "-o", "/dev/null", "-w", "%{http_code}", url],
      { encoding: "utf8" },
    ).trim();
    if (code && code !== "000") {
      console.log(`ready: ${url} (HTTP ${code})`);
      process.exit(0);
    }
  } catch {
    // Not up yet (or curl missing); keep polling.
  }
}
console.error(`timed out waiting for ${url}; check ${log}`);
process.exit(1);
