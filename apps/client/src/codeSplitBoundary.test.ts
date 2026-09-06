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

describe("the code split (ADR 0008)", () => {
  it("keeps the menu bundle free of the game module", () => {
    const violations: string[] = [];

    for (const file of sourceFiles) {
      if (sideOf(file) !== "shell") continue;
      const source = readFileSync(join(SRC, file), "utf8");
      for (const specifier of staticValueImports(source)) {
        if (!specifier.startsWith(".")) continue;
        const target = relative(SRC, resolve(SRC, dirname(file), specifier)).split("\\").join("/");
        // `.js` specifiers name TypeScript sources; the extension is irrelevant here.
        if (sideOf(target.replace(/\.(js|ts|tsx)$/, "")) === "game") {
          violations.push(`${file} statically imports ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
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
