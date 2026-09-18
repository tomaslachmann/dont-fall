import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const root = process.cwd();
const files: string[] = [];
const walk = (dir: string): void => {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "dist") continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(full)) files.push(full);
  }
};
for (const r of ["packages", "apps", "scripts"]) walk(join(root, r));
const source = new Map(files.map((f) => [f, readFileSync(f, "utf8")] as const));
// Values only: un-exporting a type that appears in an exported signature would
// shrink the public API, not tidy it.
const EXPORT = /^export\s+(?:async\s+)?(const|function|class)\s+([A-Za-z0-9_$]+)/gm;
const SKIP = /tuning\.ts$|AssetDefs\.ts$|\.test\.(ts|tsx)$/;
const out: { file: string; names: string[] }[] = [];
for (const [file, text] of source) {
  if (SKIP.test(file)) continue;
  const names: string[] = [];
  for (const m of text.matchAll(EXPORT)) {
    const name = m[2]!;
    let outside = 0;
    for (const [other, t] of source) {
      if (other === file) continue;
      outside += (t.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
    }
    const own = (text.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length - 1;
    if (outside === 0 && own > 0) names.push(name);
  }
  if (names.length > 0) out.push({ file: relative(root, file), names });
}
out.sort((a, b) => b.names.length - a.names.length);
console.log(`files: ${out.length}, symbols: ${out.reduce((n, o) => n + o.names.length, 0)}`);
for (const o of out.slice(0, 22)) console.log(`${o.names.length.toString().padStart(3)}  ${o.file}\n       ${o.names.join(", ")}`);
