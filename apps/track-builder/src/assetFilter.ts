import type { AssetCategory } from "@dont-fall/shared";

/**
 * The Assets tab's narrowing (new-design port): category → pack → saved set
 * → query, then A–Z. Pure over the tab's inputs so the tab itself only
 * applies the resulting visible set to its tiles.
 */
export interface AssetFilterState {
  query: string;
  category: AssetCategory | null;
  pack: string | null;
  /** An active saved query (recent / favourites / in-track) restricts to its set. */
  saved: ReadonlySet<string> | null;
  sort: "asc" | "desc";
}

/** "kaykit_floor_wood_2x2" → "kaykit" — the converter's id prefix is the pack. */
export const assetPackOf = (id: string): string => id.split("_")[0]!;

/** Brand spellings for the known packs; anything else capitalized, never raw. */
export const packLabel = (pack: string): string =>
  pack === "kaykit" ? "KayKit" : pack[0]!.toUpperCase() + pack.slice(1);

export const filterAssetIds = (
  ids: readonly string[],
  categoryById: Record<string, AssetCategory>,
  state: AssetFilterState,
): string[] => {
  const q = state.query.trim().toLowerCase();
  const visible = ids.filter(
    (id) =>
      (state.category === null || categoryById[id] === state.category) &&
      (state.pack === null || assetPackOf(id) === state.pack) &&
      (state.saved === null || state.saved.has(id)) &&
      (!q || id.toLowerCase().includes(q)),
  );
  visible.sort();
  if (state.sort === "desc") visible.reverse();
  return visible;
};
