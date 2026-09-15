import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * main.tsx mounts the React shell onto `#root` with no null check — a typo
 * on either side is a blank builder page at load, failing no other test.
 * This pins the mount contract (root element, entry script, display fonts)
 * against index.html instead.
 */
describe("builder shell mount", () => {
  it("provides the root, entry and fonts main.tsx needs", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const html = readFileSync(path.join(root, "index.html"), "utf8");
    const main = readFileSync(path.join(root, "src", "main.tsx"), "utf8");

    expect(main).toMatch(/getElementById\("root"\)/);
    expect(html).toMatch(/id="root"/);
    expect(html).toMatch(/src="\/src\/main\.tsx"/);
    expect(html).toMatch(/Fredoka/);
    expect(html).toMatch(/Nunito/);
  });
});

describe("builder Playtest target (m8.1 ticket 04)", () => {
  it("opens the free-roam session, not the match Lobby — one button, one purpose", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const engine = readFileSync(path.join(root, "src", "engine.ts"), "utf8");

    // The publish-first flow is unchanged (still `publishPlaytestTrack`);
    // only the opened route changed: `&freeroam=1` is the free-roam boot.
    expect(engine).toMatch(/publishPlaytestTrack/);
    expect(engine).toMatch(/\/play\?track=.*&freeroam=1/);
  });
});
