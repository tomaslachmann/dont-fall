import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The builder's visual contract, pinned at the source level (same precedent
 * as shell.test.ts): the client-aligned scale and the overflow guards that
 * keep the palette inside its frame. There is no layout engine here to
 * render against — but every one of these rules exists because its absence
 * visibly broke the tool, so each gets a pin against silent removal.
 */
const root = path.resolve(import.meta.dirname, "..", "..");
const css = (name: string): string => readFileSync(path.join(root, "src", name), "utf8");

describe("builder scale (one app with the game)", () => {
  it("sits controls on the client's own metrics: 13px labels, 11px kickers", () => {
    const tokens = css("styles/builder.css");
    expect(tokens).toMatch(/--tb-t-sm:\s*13px/);
    expect(tokens).toMatch(/--tb-t-2xs:\s*11px/);
    expect(tokens).toMatch(/--tb-palette-w:\s*264px/);
    expect(tokens).toMatch(/--tb-inspector-w:\s*336px/);
  });
});

describe("palette overflow guards", () => {
  it("tiles can never force their grid column past 1fr", () => {
    const tiles = css("components/AssetsTab/AssetsTab.module.css");
    expect(tiles).toMatch(/\.tile\s*\{[^}]*min-width:\s*0/);
    expect(tiles).toMatch(/\.tileName\s*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it("counted tab controls stack their counts under the label", () => {
    const segmented = css("components/SegmentedControl/SegmentedControl.module.css");
    expect(segmented).toMatch(/\.item\s*\{[^}]*min-width:\s*0/);
    expect(segmented).toMatch(/\.item\s*\{[^}]*overflow:\s*hidden/);
    expect(segmented).toMatch(/\.stack\s*>\s*\.item/);
    const palette = readFileSync(path.join(root, "src", "components", "ModulePalette", "ModulePalette.tsx"), "utf8");
    expect(palette).toMatch(/layout="stack"/);
    const assets = readFileSync(path.join(root, "src", "components", "AssetsTab", "AssetsTab.tsx"), "utf8");
    expect(assets).toMatch(/layout="stack"/);
  });

  it("long single-line texts clip with an ellipsis instead of pushing frames", () => {
    const toolbar = css("components/Toolbar/Toolbar.module.css");
    expect(toolbar).toMatch(/\.status\s*\{[^}]*max-width:[^}]*text-overflow:\s*ellipsis/);
    expect(toolbar).toMatch(/\.apiUrl\s*\{[^}]*text-overflow:\s*ellipsis/);
    const inspector = css("components/Inspector/Inspector.module.css");
    expect(inspector).toMatch(/\.sub\s*\{[^}]*text-overflow:\s*ellipsis/);
    const browse = css("components/BrowsePanel/BrowsePanel.module.css");
    expect(browse).toMatch(/\.name\s*\{[^}]*min-width:\s*0/);
  });
});
