// Usage: node scripts/prof-top.mjs <dir with .cpuprofile>  -> top self-time functions
import { readFileSync, readdirSync } from "node:fs";
const dir = process.argv[2];
const p = JSON.parse(readFileSync(dir + "/" + readdirSync(dir)[0], "utf8"));
const by = new Map(p.nodes.map((n) => [n.id, n]));
const self = new Map();
p.samples.forEach((id, i) => {
  const n = by.get(id).callFrame;
  const k = `${n.functionName} ${n.url.split("/").slice(-2).join("/")}:${n.lineNumber + 1}`;
  self.set(k, (self.get(k) || 0) + p.timeDeltas[i]);
});
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log("total ms", (total / 1e3).toFixed(0));
[...self]
  .sort((a, b) => b[1] - a[1])
  .slice(0, Number(process.argv[3] ?? 14))
  .forEach(([k, v]) => console.log((v / 1e3).toFixed(0).padStart(8), "ms", k));
