import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR 0008's code split, as a test.
 *
 * `GameCanvas` loads the game module with a dynamic `import()` so the menu does
 * not pay for Three.js, the Rapier WASM and the character model before anyone
 * has clicked Play. Nothing enforces that: a single static import from a Screen
 * into the renderer would pull the whole engine into the menu bundle, fail no
 * test, break no feature, and be noticed only by someone measuring a cold load.
 *
 * M4.5 ticket 08 organised this package by kind rather than by that boundary,
 * which means the boundary is no longer visible in the directory tree. This
 * file is what replaces it — so the two sets are named here, once, and adding a
 * directory forces a decision about which side it is on.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)));

/** Ships in the menu bundle — loaded before anyone clicks Play. */
const SHELL = ["App.tsx", "main.tsx", "screens", "components"];

/** Behind the dynamic import — must not reach the menu bundle. */
const GAME = ["game", "render", "net", "hud", "input"];

const startsWithSegment = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const sourceFiles = walk(SRC)
  .map((f) => relative(SRC, f).split("\\").join("/"))
  .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

/**
 * Static, value-level imports only. `import type` is erased at build time and
 * pulls nothing into the bundle, and `import(...)` is the split itself — both
 * are exactly what the shell is allowed to do.
 */
const staticValueImports = (source: string): string[] => {
  const withoutTypeOnly = source
    .replace(/\bimport\s+type\b[\s\S]*?from\s*["'][^"']+["']/g, "")
    .replace(/\bexport\s+type\b[\s\S]*?from\s*["'][^"']+["']/g, "");
  const specifiers: string[] = [];
  for (const match of withoutTypeOnly.matchAll(/(?:from|^\s*import)\s*["']([^"']+)["']/gm)) {
    specifiers.push(match[1]!);
  }
  return specifiers;
};

const sideOf = (fileFromSrc: string): "shell" | "game" | "neither" => {
  if (SHELL.some((p) => startsWithSegment(fileFromSrc, p))) return "shell";
  if (GAME.some((p) => startsWithSegment(fileFromSrc, p))) return "game";
  return "neither";
};

/** The src-relative files `file` statically imports by value, extension-normalised. */
const importsOf = (file: string): string[] => {
  const source = readFileSync(join(SRC, file), "utf8");
  return staticValueImports(source)
    .filter((specifier) => specifier.startsWith("."))
    .map((specifier) => relative(SRC, resolve(SRC, dirname(file), specifier)).split("\\").join("/"))
    // `.js` specifiers name TypeScript sources; the extension is irrelevant here.
    .map((target) => target.replace(/\.(js|ts|tsx)$/, ""));
};

/** Resolve an extensionless src-relative target back to the file that provides it. */
const fileFor = (target: string): string | undefined =>
  sourceFiles.find((f) => f.replace(/\.(ts|tsx)$/, "") === target || f.replace(/\.(ts|tsx)$/, "") === `${target}/index`);

describe("the code split (ADR 0008)", () => {
  it("keeps the menu bundle free of the game module", () => {
    const violations: string[] = [];

    // Followed transitively, not just one hop: a shell file importing a
    // neutral helper that itself imports the renderer pulls the engine in
    // just as surely, and that is the version nobody would notice.
    for (const entry of sourceFiles.filter((f) => sideOf(f) === "shell")) {
      const seen = new Set<string>([entry]);
      const queue = [entry];
      while (queue.length > 0) {
        const file = queue.shift()!;
        for (const target of importsOf(file)) {
          if (sideOf(target) === "game") {
            violations.push(
              file === entry
                ? `${entry} statically imports ${target}`
                : `${entry} reaches ${target} via ${file}`,
            );
            continue;
          }
          const next = fileFor(target);
          if (next && !seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("catches the engine arriving through a neutral helper, not just directly", () => {
    // The transitive case, proven rather than assumed: `lib/` is a leaf today,
    // so the direct-only version of this test would pass either way.
    expect(fileFor("lib/connection")).toBe("lib/connection.ts");
    expect(sideOf("render/scene")).toBe("game");
    expect(sideOf("lib/connection")).toBe("neither");
  });

  it("still has a shell and a game side to tell apart", () => {
    // Guards the guard: if a rename emptied either set, the test above would
    // pass by having nothing to check.
    const sides = sourceFiles.map(sideOf);
    expect(sides.filter((s) => s === "shell").length).toBeGreaterThan(0);
    expect(sides.filter((s) => s === "game").length).toBeGreaterThan(0);
  });

  it("catches a static import that would drag the engine into the menu", () => {
    // The failure mode itself, exercised — otherwise the assertion above is
    // only ever observed passing.
    const offending = 'import { createStage } from "../render/scene.js";';
    const target = relative(SRC, resolve(SRC, "screens", "../render/scene.js")).split("\\").join("/");

    expect(staticValueImports(offending)).toEqual(["../render/scene.js"]);
    expect(sideOf(target.replace(/\.(js|ts|tsx)$/, ""))).toBe("game");
  });

  it("allows the two things the shell legitimately does", () => {
    const typeOnly = 'import type { GameHandle } from "../game/index.js";';
    const dynamic = 'const mod = await import("../game/index.js");';

    expect(staticValueImports(typeOnly)).toEqual([]);
    expect(staticValueImports(dynamic)).toEqual([]);
  });
});
