import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * main.ts queries its shell by element id (`$("...")`, cast without a null
 * check) — a typo on either side is a blank builder page at load, failing
 * no other test (there is no DOM here to boot it against). This pins every
 * queried id against index.html instead. Only literal `$("...")` /
 * `$<T>("...")` calls are covered; anything dynamic would need a real DOM.
 */
describe("builder shell ids", () => {
  it("provides every element id main.ts queries", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const html = readFileSync(path.join(root, "index.html"), "utf8");
    const main = readFileSync(path.join(root, "src", "main.ts"), "utf8");
    const provided = new Set([...html.matchAll(/id="([a-z-]+)"/g)].map((match) => match[1]));
    const queried = new Set([...main.matchAll(/\$\s*(?:<[A-Za-z]+>)?\s*\("([a-z-]+)"\)/g)].map((match) => match[1]));

    expect(queried.size).toBeGreaterThan(0);
    for (const id of queried) expect(provided.has(id), `index.html lacks #${id}`).toBe(true);
  });
});
