import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTrack } from "./track/trackSource.js";

// An Environment is render-only (ADR 0074): the Match server fetches the
// Revision that names one, and must never read the name. It is not in
// `RoundRules`, never on the Snapshot, and the shared step never sees it.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Where the authority and the shared step live. */
const AUTHORITY = [
  "apps/server/src",
  "packages/shared/src/simulation",
  "packages/shared/src/match",
  "packages/shared/src/net",
  "packages/shared/src/state",
];

const READS_AN_ENVIRONMENT = /\b(?:EnvironmentId|EnvironmentPreset|ENVIRONMENT_PRESETS|ENVIRONMENT_IDS|resolveEnvironmentId)\b|\.environment\b/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => /\.[cm]?tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
    .map((path) => join(dir, path));

describe("the Match server never reads a Revision's Environment (ADR 0074)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops it from the fetched Revision", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ id: "t", revision: 3, track: [], timeLimitMs: 60_000, survivorTarget: 2, environment: "night" }),
    }));

    const fetched = await fetchTrack("http://api.test", { trackId: "t" });

    expect(Object.keys(fetched).sort()).toEqual(["id", "revision", "survivorTarget", "timeLimitMs", "track"]);
  });

  it.each(AUTHORITY)("finds nothing in %s that names one", (dir) => {
    const offending = sourceFiles(join(repoRoot, dir))
      .filter((file) => READS_AN_ENVIRONMENT.test(readFileSync(file, "utf8")))
      .map((file) => relative(repoRoot, file));
    expect(offending).toEqual([]);
  });

  it("recognises what it is looking for", () => {
    expect(READS_AN_ENVIRONMENT.test("const preset = ENVIRONMENT_PRESETS[fetched.environment];")).toBe(true);
    expect(READS_AN_ENVIRONMENT.test("import type { EnvironmentId } from '@dont-fall/shared';")).toBe(true);
    expect(READS_AN_ENVIRONMENT.test("const rules = resolveRoundRules(defaults); // no environment here")).toBe(false);
  });
});
