import { useEffect, useMemo, useState } from "react";
import { MODULE_LIBRARY } from "@dont-fall/shared";
import css from "./ModulePalette.module.css";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import { ModuleRow } from "../ModuleRow/ModuleRow";
import { AssetsTab } from "../AssetsTab/AssetsTab";
import { SearchIcon } from "../icons/Icons";
import type { BuilderEngine } from "../../engine.js";
import { assetTabModuleIds } from "../../assets.js";
import { filterModuleIds, groupProceduralModules, moduleMeta, prettyModuleName } from "../../palette.js";
import type { PaletteMode, PaletteTab } from "../../types/builder";

const GROUPS = groupProceduralModules(MODULE_LIBRARY);
const PROCEDURAL_COUNT = GROUPS.reduce((n, g) => n + g.moduleIds.length, 0);
const ASSET_COUNT = assetTabModuleIds().length;

/** Region A. BUILD places Modules; COMPOSE (M10) will edit a Module's interior. Same three regions. */
export function ModulePalette({ engine }: { engine: BuilderEngine }) {
  const [tab, setTab] = useState<PaletteTab>("procedural");
  const [query, setQuery] = useState("");
  // The switch is M10's named room: rendered, but COMPOSE stays unwired until
  // the interior editor exists (its title says so).
  const mode: PaletteMode = "build";

  // Bytes load once per session, on first Assets open — from the API, never
  // a builder-local copy. The engine guards the double-invoke itself.
  useEffect(() => {
    if (tab === "assets") engine.ensureAssetTemplates();
  }, [engine, tab]);

  const matches = useMemo(() => {
    const ids = GROUPS.flatMap((g) => g.moduleIds);
    return new Set(filterModuleIds(ids, query));
  }, [query]);

  return (
    <aside className={css.root}>
      <header className={css.head}>
        <h2 className={css.title}>Modules</h2>
        <SegmentedControl shape="pill" size="sm" value={mode} onChange={() => {}}
          items={[
            { value: "build", label: "BUILD" },
            { value: "compose", label: "COMPOSE", title: "M10 — module interior editor" },
          ]} />
      </header>

      <div className={css.filters}>
        {tab === "procedural" && (
          <label className={css.search}>
            <SearchIcon size={13} />
            <input className={css.searchInput} value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="search modules…" aria-label="search modules" />
          </label>
        )}
        <SegmentedControl tone="plastic" value={tab} onChange={setTab}
          items={[
            { value: "procedural", label: "PROCEDURAL", count: PROCEDURAL_COUNT },
            { value: "assets", label: "ASSETS", count: ASSET_COUNT },
          ]} />
      </div>

      <div className={css.list} hidden={tab !== "procedural"}>
        {GROUPS.map((g) => {
          const visible = g.moduleIds.filter((id) => matches.has(id));
          if (visible.length === 0) return null;
          return (
            <section key={g.id} className={css.group}>
              <h3 className={css.groupLabel}>{g.label} · {g.moduleIds.length}</h3>
              {visible.map((id) => (
                <ModuleRow key={id} engine={engine} moduleId={id}
                  name={prettyModuleName(id)} meta={moduleMeta(MODULE_LIBRARY[id]!)} visible />
              ))}
            </section>
          );
        })}
      </div>

      {/* Stays mounted while hidden: tab switches keep filters, scroll and previews. */}
      <AssetsTab engine={engine} hidden={tab !== "assets"} />

      <footer className={css.foot}>
        {mode === "build" ? "CLICK = PLACE AFTER SELECTION · APPENDS AT END" : "COMPOSE · EDIT THE MODULE INTERIOR"}
      </footer>
    </aside>
  );
}
