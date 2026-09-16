import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// This package's mandate (ADR 0074): three.js rendering shared by the game and
// the Track builder, never imported by the Match server or the API. Neither may
// reach three.js by any other route either (ADR 0050) — and the root
// package.json lists `three`, so a bare import would still resolve from there;
// the source scan below is what actually holds the line.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SERVER_SIDE = ["apps/server", "apps/api", "packages/shared"];

const isRenderOnly = (specifier: string): boolean =>
  specifier === "three" ||
  specifier.startsWith("three/") ||
  specifier === "@dont-fall/render" ||
  specifier.startsWith("@dont-fall/render/") ||
  specifier.includes("packages/render");

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => /\.(?:[cm]?[jt]sx?)$/.test(path) && !path.split(/[\\/]/).includes("node_modules"))
    .map((path) => join(dir, path));

describe("the render boundary", () => {
  it.each(SERVER_SIDE)("keeps three.js and @dont-fall/render out of %s's dependencies", (workspace) => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, workspace, "package.json"), "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    expect(Object.keys(deps).filter(isRenderOnly)).toEqual([]);
  });

  it.each(SERVER_SIDE)("finds no import of three.js or @dont-fall/render in %s", (workspace) => {
    const offending: string[] = [];
    for (const file of sourceFiles(join(repoRoot, workspace, "src"))) {
      for (const match of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
        if (isRenderOnly(match[1]!)) offending.push(`${relative(repoRoot, file)} imports ${match[1]}`);
      }
    }
    expect(offending).toEqual([]);
  });

  it("recognises what it is looking for", () => {
    const found = (source: string): string[] =>
      [...source.matchAll(SPECIFIER)].map((match) => match[1]!).filter(isRenderOnly);
    expect(found('import * as THREE from "three";')).toEqual(["three"]);
    expect(found("import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';")).toHaveLength(1);
    expect(found('const m = await import("@dont-fall/render");')).toEqual(["@dont-fall/render"]);
    expect(found('import "../../../packages/render/src/index.js";')).toHaveLength(1);
    expect(found('export { createEnvironment } from "@dont-fall/render";')).toHaveLength(1);
    expect(found('import { vec3 } from "@dont-fall/shared";\nimport { three } from "./three.js";')).toEqual([]);
  });
});
