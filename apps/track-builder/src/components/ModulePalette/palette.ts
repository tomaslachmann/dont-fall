import type { Module } from "@dont-fall/shared";

/**
 * The procedural tab's groups (new-design port): the flat `MODULE_LIBRARY`
 * presented in build order — path first, flavor second, danger third.
 * Derived from what each Module *does*, so a new Module lands in a group
 * without anyone editing a list.
 */
export interface PaletteGroup {
  id: string;
  label: string;
  moduleIds: string[];
}

const groupOf = (module: Module): string => {
  if ((module.spinners?.length ?? 0) > 0 || (module.props?.length ?? 0) > 0) return "hazard";
  if (
    module.surface !== undefined ||
    (module.speedPads?.length ?? 0) > 0 ||
    (module.launchPads?.length ?? 0) > 0 ||
    (module.volumes?.length ?? 0) > 0
  )
    return "pads";
  return "core";
};

export const groupProceduralModules = (library: Record<string, Module>): PaletteGroup[] => {
  const groups: PaletteGroup[] = [
    { id: "core", label: "Core path", moduleIds: [] },
    { id: "pads", label: "Pads & surfaces", moduleIds: [] },
    { id: "hazard", label: "Hazard", moduleIds: [] },
  ];
  for (const id of Object.keys(library)) groups.find((g) => g.id === groupOf(library[id]!))!.moduleIds.push(id);
  return groups;
};

/** "2 sockets · 8×6u" — the row's sub-line, read off the Module itself. */
export const moduleMeta = (module: Module): string => {
  const sockets = module.sockets.length;
  const w = module.footprint.bounds.halfExtents.x * 2;
  const d = module.footprint.bounds.halfExtents.z * 2;
  return `${sockets} socket${sockets === 1 ? "" : "s"} · ${w}×${d}u`;
};

/** "checkpoint-spinner" → "Checkpoint Spinner" — the row's display name. */
export const prettyModuleName = (id: string): string =>
  id
    .split("-")
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");

/** The palette search: a case-insensitive substring over ids, empty keeps all. */
export const filterModuleIds = (ids: readonly string[], query: string): string[] => {
  const q = query.trim().toLowerCase();
  return q ? ids.filter((id) => id.toLowerCase().includes(q)) : [...ids];
};
