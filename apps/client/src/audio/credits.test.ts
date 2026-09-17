import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { creditsView, parseSoundCredits, requiresAttribution, type SoundCredit } from "./credits.js";

const soundsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "sounds");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

describe("the sound library's credits (M14 ticket 01, ADR 0087)", () => {
  const credits = parseSoundCredits(readFileSync(join(soundsDir, "CREDITS.md"), "utf8"));
  const shipped = walk(soundsDir)
    .map((path) => relative(soundsDir, path).split("\\").join("/"))
    .filter((path) => path !== "CREDITS.md" && !path.endsWith(".DS_Store"));

  it("names every shipped file exactly once, and nothing that isn't shipped", () => {
    const named = credits.map((credit) => credit.file);
    expect(new Set(named).size).toBe(named.length);
    expect([...named].sort()).toEqual([...shipped].sort());
  });

  it("ships only .ogg", () => {
    expect(shipped.filter((path) => !path.endsWith(".ogg"))).toEqual([]);
  });

  it("links every file a licence obliges us to credit to its source", () => {
    for (const credit of credits.filter((c) => requiresAttribution(c.licence))) {
      expect(credit.url, credit.file).toMatch(/^https:\/\//);
    }
  });
});

describe("parseSoundCredits", () => {
  const header = "| File | Title | Author | Licence | Source |\n|---|---|---|---|---|\n";

  it("reads a row, with or without a source link", () => {
    expect(
      parseSoundCredits(
        `${header}| \`segment/fan_loop.ogg\` | Wind.wav | Cyril Laurier | CC-BY 4.0 | <https://freesound.org/s/17645/> |\n` +
          "| `music/round_0.ogg` | Gameplay 2 | the game's author | Generated | — |\n",
      ),
    ).toEqual([
      { file: "segment/fan_loop.ogg", title: "Wind.wav", author: "Cyril Laurier", licence: "CC-BY 4.0", url: "https://freesound.org/s/17645/" },
      { file: "music/round_0.ogg", title: "Gameplay 2", author: "the game's author", licence: "Generated", url: undefined },
    ]);
  });

  it("refuses a licence outside the allowed set, such as non-commercial", () => {
    expect(() => parseSoundCredits(`${header}| \`a.ogg\` | T | A | CC-BY-NC 4.0 | <https://x> |\n`)).toThrow(/unknown licence/);
  });

  it("refuses a CC-BY row without its source link (M14 ticket 14)", () => {
    expect(() => parseSoundCredits(`${header}| \`a.ogg\` | T | A | CC-BY 4.0 | — |\n`)).toThrow(/source link/);
    expect(() => parseSoundCredits(`${header}| \`a.ogg\` | T | A | CC0 | — |\n`)).not.toThrow();
  });

  it("refuses a row with a missing cell", () => {
    expect(() => parseSoundCredits(`${header}| \`a.ogg\` | T |  | CC0 | <https://x> |\n`)).toThrow(/unreadable/);
  });
});

describe("creditsView (M14 ticket 14)", () => {
  const credit = (over: Partial<SoundCredit>): SoundCredit => ({
    file: "x.ogg",
    title: "T",
    author: "A",
    licence: "CC0",
    url: "https://example.test",
    ...over,
  });

  it("names each CC-BY work once, however many files are cut from it", () => {
    const view = creditsView([
      credit({ file: "a.ogg", title: "Wind.wav", author: "Cyril Laurier", licence: "CC-BY 4.0", url: "https://freesound.org/s/17645/" }),
      credit({ file: "b.ogg", title: "Wind.wav", author: "Cyril Laurier", licence: "CC-BY 4.0", url: "https://freesound.org/s/17645/" }),
      credit({ file: "c.ogg", title: "XRayBelt.aif", author: "mwl500", licence: "CC-BY 3.0", url: "https://freesound.org/s/49972/" }),
    ]);
    expect(view.attribution).toEqual([
      { title: "Wind.wav", author: "Cyril Laurier", licence: "CC-BY 4.0", url: "https://freesound.org/s/17645/" },
      { title: "XRayBelt.aif", author: "mwl500", licence: "CC-BY 3.0", url: "https://freesound.org/s/49972/" },
    ]);
  });

  it("thanks each CC0 author once, with their works, and names the music's tools", () => {
    const view = creditsView([
      credit({ title: "Impact Sounds", author: "Kenney (www.kenney.nl)", url: "https://kenney.nl/assets/impact-sounds" }),
      credit({ title: "Impact Sounds", author: "Kenney (www.kenney.nl)", url: "https://kenney.nl/assets/impact-sounds" }),
      credit({ title: "Digital Audio", author: "Kenney (www.kenney.nl)", url: "https://kenney.nl/assets/digital-audio" }),
      credit({ title: "woosh", author: "moogy73" }),
      credit({ title: "Gameplay", author: "the game's author, generated with Suno", licence: "Generated", url: undefined }),
      credit({ title: "Gameplay 2", author: "the game's author, generated with Stable Audio", licence: "Generated", url: undefined }),
    ]);
    expect(view.thanks).toEqual([
      {
        author: "Kenney (www.kenney.nl)",
        works: [
          { title: "Digital Audio", url: "https://kenney.nl/assets/digital-audio" },
          { title: "Impact Sounds", url: "https://kenney.nl/assets/impact-sounds" },
        ],
      },
      { author: "moogy73", works: [{ title: "woosh", url: "https://example.test" }] },
    ]);
    expect(view.musicTools).toEqual(["Stable Audio", "Suno"]);
    expect(view.attribution).toEqual([]);
  });

  it("credits every CC-BY file the game ships", () => {
    const credits = parseSoundCredits(readFileSync(join(soundsDir, "CREDITS.md"), "utf8"));
    const view = creditsView(credits);
    for (const shipped of credits.filter((c) => requiresAttribution(c.licence))) {
      expect(view.attribution).toContainEqual({ title: shipped.title, author: shipped.author, licence: shipped.licence, url: shipped.url });
    }
    expect(view.thanks.map((entry) => entry.author)).toContain("Kenney (www.kenney.nl)");
  });
});
