import { MODULE_LIBRARY } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { filterModuleIds, groupProceduralModules, moduleMeta, prettyModuleName } from "./palette.js";

describe("groupProceduralModules", () => {
  it("covers every library Module exactly once, in build order", () => {
    const groups = groupProceduralModules(MODULE_LIBRARY);
    expect(groups.map((g) => g.label)).toEqual(["Core path", "Pads & surfaces", "Hazard"]);
    const listed = groups.flatMap((g) => g.moduleIds);
    expect([...listed].sort()).toEqual(Object.keys(MODULE_LIBRARY).sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("sorts by what the piece does, not its name", () => {
    const byId = Object.fromEntries(
      groupProceduralModules(MODULE_LIBRARY).flatMap((g) => g.moduleIds.map((id) => [id, g.label])),
    );
    // Plain chaining pieces (a checkpoint or finish zone is still a path piece).
    for (const id of ["start", "bridge", "bridge-2", "sandbox", "finish", "arena"]) expect(byId[id]).toBe("Core path");
    // Surfaces and pad/volume mechanics.
    for (const id of ["mud", "ice", "speed-pad", "slow-pad", "bounce", "launch-pad", "updraft"])
      expect(byId[id]).toBe("Pads & surfaces");
    // Things that move or can be shoved into you.
    for (const id of ["checkpoint-spinner", "checkpoint-end-props"]) expect(byId[id]).toBe("Hazard");
  });

  it("a hazard mechanic wins over a pad mechanic when a Module carries both", () => {
    const groups = groupProceduralModules({
      ...MODULE_LIBRARY,
      hybrid: {
        ...MODULE_LIBRARY["mud"]!,
        id: "hybrid",
        spinners: [{ ...MODULE_LIBRARY["checkpoint-spinner"]!.spinners![0]! }],
      },
    });
    const byId = Object.fromEntries(groups.flatMap((g) => g.moduleIds.map((id) => [id, g.label])));
    expect(byId["hybrid"]).toBe("Hazard");
  });
});

describe("moduleMeta", () => {
  it("reads sockets and footprint off the Module, never hardcoded", () => {
    expect(moduleMeta(MODULE_LIBRARY["bridge"]!)).toBe("2 sockets · 8×6u");
    expect(moduleMeta(MODULE_LIBRARY["arena"]!)).toBe("0 sockets · 12×12u");
  });
});

describe("prettyModuleName", () => {
  it("title-cases dashed ids", () => {
    expect(prettyModuleName("checkpoint-spinner")).toBe("Checkpoint Spinner");
    expect(prettyModuleName("bridge")).toBe("Bridge");
  });
});

describe("filterModuleIds", () => {
  it("matches case-insensitively, empty query keeps all", () => {
    const ids = ["bridge", "bridge-2", "checkpoint-spinner"];
    expect(filterModuleIds(ids, "")).toEqual(ids);
    expect(filterModuleIds(ids, "BRIDGE")).toEqual(["bridge", "bridge-2"]);
    expect(filterModuleIds(ids, "spin")).toEqual(["checkpoint-spinner"]);
    expect(filterModuleIds(ids, "zzz")).toEqual([]);
  });
});
