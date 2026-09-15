import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ASSET_MODULE_DEFS, type AssetCategory } from "@dont-fall/shared";
import css from "./AssetsTab.module.css";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import { Chip } from "../Chip/Chip";
import { SearchIcon } from "../icons/Icons";
import { IMPACT } from "../../lib/impact";
import type { BuilderEngine } from "../../engine.js";
import { assetCategoryById, assetTabModuleIds } from "../../assets/assets.js";
import { assetPackOf, filterAssetIds, packLabel } from "../../assets/assetFilter.js";
import { useEngineVersion } from "../../hooks/useEngine.js";

const IDS = assetTabModuleIds();
const CATEGORY_BY_ID = assetCategoryById();
const HAZARD_BY_ID = new Set(ASSET_MODULE_DEFS.filter((def) => def.hazard).map((def) => def.id));
const PACKS = [...new Set(IDS.map(assetPackOf))].sort();
const PACK_COUNT = new Map(PACKS.map((pack) => [pack, IDS.filter((id) => assetPackOf(id) === pack).length]));
const CATEGORY_COUNT = new Map<string, number>();
for (const id of IDS) CATEGORY_COUNT.set(CATEGORY_BY_ID[id]!, (CATEGORY_COUNT.get(CATEGORY_BY_ID[id]!) ?? 0) + 1);

type SavedKind = "recent" | "favourites" | "intrack";

const FAVOURITES_KEY = "tb-asset-favourites";
const loadFavourites = (): Set<string> => {
  try {
    if (typeof localStorage === "undefined") return new Set();
    const raw = localStorage.getItem(FAVOURITES_KEY);
    if (!raw) return new Set();
    return new Set((JSON.parse(raw) as string[]).filter((id) => IDS.includes(id)));
  } catch {
    return new Set();
  }
};

/** One tile: a live GLB still once its bytes parse, a shimmer while queued, `!` on failure (click retries). */
const AssetTile = memo(function AssetTile({
  engine,
  moduleId,
  ready,
  error,
  selected,
  favourite,
  onToggleFavourite,
}: {
  engine: BuilderEngine;
  moduleId: string;
  ready: boolean;
  error: string | undefined;
  selected: boolean;
  favourite: boolean;
  onToggleFavourite: (moduleId: string) => void;
}) {
  const entryRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!ready) return;
    const entry = entryRef.current;
    const canvas = canvasRef.current;
    if (!entry || !canvas) return;
    return engine.attachPreview(entry, canvas, moduleId);
  }, [engine, moduleId, ready]);

  const state = error ? css.error : selected ? css.selected : !ready ? css.loading : "";
  const activate = (): void => {
    if (error) engine.retryAsset(moduleId);
    else engine.placeModule(moduleId);
  };
  return (
    // A div, not a button: the tile carries a nested favourite button, which
    // HTML forbids inside a <button>. Role + keyboard handling keep it operable.
    <div ref={entryRef} className={css.tile} title={error ?? moduleId}
      role="button" tabIndex={0}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
      onPointerEnter={() => canvasRef.current && engine.setPreviewHovered(canvasRef.current, true)}
      onPointerLeave={() => canvasRef.current && engine.setPreviewHovered(canvasRef.current, false)}>
      <span className={[css.preview, state].join(" ")}>
        {error ? (
          "!"
        ) : (
          <canvas ref={canvasRef} width={96} height={96} />
        )}
        {HAZARD_BY_ID.has(moduleId) && (
          <span className={css.hazard} title={IMPACT.knockdown.word.toLowerCase()}
            style={{ background: IMPACT.knockdown.color }} />
        )}
        <button type="button" aria-label={favourite ? "unfavourite" : "favourite"}
          className={[css.star, favourite ? css.starred : ""].join(" ")}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavourite(moduleId);
          }}>
          {favourite ? "★" : "☆"}
        </button>
      </span>
      <span className={[css.tileName, error ? css.errorName : ""].join(" ")}>{moduleId}</span>
    </div>
  );
});

/** Three levels of narrowing: category → pack group → 3-up grid. Built for 400+ assets. */
export function AssetsTab({ engine, hidden }: { engine: BuilderEngine; hidden?: boolean }) {
  useEngineVersion(engine);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AssetCategory>("platform");
  const [pack, setPack] = useState<string | null>(null);
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const [saved, setSaved] = useState<SavedKind | null>(null);
  const [favourites, setFavourites] = useState<Set<string>>(loadFavourites);
  const [openPacks, setOpenPacks] = useState<Set<string>>(() => new Set(PACKS));

  const toggleFavourite = useCallback((moduleId: string) => {
    setFavourites((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      try {
        localStorage.setItem(FAVOURITES_KEY, JSON.stringify([...next]));
      } catch {
        // Private mode / quota — favourites just don't survive the session.
      }
      return next;
    });
  }, []);

  // Asset ids only — a procedural Segment in the Track must not inflate the chip count.
  const inTrack = useMemo(
    () => new Set(engine.track.map((s) => s.moduleId).filter((id) => id in CATEGORY_BY_ID)),
    [engine, engine.track],
  );
  const savedSet = useMemo(() => {
    if (saved === "recent") return new Set(engine.recentAssets);
    if (saved === "favourites") return favourites;
    if (saved === "intrack") return inTrack;
    return null;
  }, [saved, engine.recentAssets, favourites, inTrack]);

  const visible = useMemo(
    () => filterAssetIds(IDS, CATEGORY_BY_ID, { query, category, pack, saved: savedSet, sort }),
    [query, category, pack, savedSet, sort],
  );
  const errors = IDS.filter((id) => engine.assetError(id) !== undefined).length;

  const savedChips: { kind: SavedKind; label: string; count: number }[] = [
    { kind: "recent", label: "RECENT", count: engine.recentAssets.length },
    { kind: "favourites", label: "FAVOURITES", count: favourites.size },
    { kind: "intrack", label: "IN THIS TRACK", count: inTrack.size },
  ];

  return (
    <div className={css.root} hidden={hidden}>
      <label className={css.search}>
        <SearchIcon size={12} />
        <input className={css.searchInput} value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="search assets…" aria-label="search assets" />
        <span className={css.hits}>{visible.length} hits</span>
      </label>

      <SegmentedControl size="sm" layout="stack" value={category} onChange={setCategory}
        items={(["platform", "obstacle", "scenery"] as const).map((c) => ({
          value: c,
          label: c.toUpperCase(),
          count: CATEGORY_COUNT.get(c) ?? 0,
        }))} />

      <div className={css.dropdowns}>
        <label className={css.dropdown}>
          <select className={css.select} value={pack ?? ""} aria-label="pack"
            onChange={(e) => setPack(e.target.value === "" ? null : e.target.value)}>
            <option value="">All packs</option>
            {PACKS.map((p) => (
              <option key={p} value={p}>{packLabel(p)} · {PACK_COUNT.get(p)}</option>
            ))}
          </select>
          <span className={css.caret}>⌄</span>
        </label>
        <label className={css.dropdown}>
          <select className={css.select} value={sort} aria-label="sort"
            onChange={(e) => setSort(e.target.value as "asc" | "desc")}>
            <option value="asc">A–Z</option>
            <option value="desc">Z–A</option>
          </select>
          <span className={css.caret}>⌄</span>
        </label>
      </div>

      <div className={css.saved}>
        {savedChips.map((q) => (
          <Chip key={q.kind} tone={q.kind === saved ? "ink" : "quiet"}
            onClick={() => setSaved((prev) => (prev === q.kind ? null : q.kind))}>
            {q.label} {q.count}
          </Chip>
        ))}
      </div>

      {PACKS.map((p) => {
        const tiles = visible.filter((id) => assetPackOf(id) === p);
        if (tiles.length === 0) return null;
        const open = openPacks.has(p);
        return (
          <div key={p} className={css.pack}>
            <button type="button" className={css.packHead}
              onClick={() => setOpenPacks((prev) => {
                const next = new Set(prev);
                if (next.has(p)) next.delete(p);
                else next.add(p);
                return next;
              })}>
              <span className={css.packLabel}>{packLabel(p)}</span>
              <span className={css.packCount}>{PACK_COUNT.get(p)}</span>
              <span className={css.packCaret}>{open ? "⌄" : "›"}</span>
            </button>

            {open && (
              <div className={css.grid}>
                {tiles.map((id) => (
                  <AssetTile key={id} engine={engine} moduleId={id}
                    ready={engine.templateFor(id) !== undefined}
                    error={engine.assetError(id)}
                    selected={inTrack.has(id)}
                    favourite={favourites.has(id)}
                    onToggleFavourite={toggleFavourite} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <span className={css.footer}>
        SHOWING {visible.length} OF {IDS.length}{errors > 0 ? ` · ${errors} FAILED` : ""} · SCROLL FOR MORE
      </span>
    </div>
  );
}
