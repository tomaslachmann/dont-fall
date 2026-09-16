import { useEffect } from "react";
import css from "./ModulePalette.module.css";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import { AssetsTab } from "../AssetsTab/AssetsTab";
import type { BuilderEngine } from "../../engine.js";
import type { PaletteMode } from "../../types/builder";

/**
 * Region A. BUILD places Modules; COMPOSE (M10) will edit a Module's interior. Same three regions.
 * Asset Modules only (ADR 0078) — the procedural tab went once nothing procedural was left to place.
 */
export function ModulePalette({ engine }: { engine: BuilderEngine }) {
  // The switch is M10's named room: rendered, but COMPOSE stays unwired until
  // the interior editor exists (its title says so).
  const mode: PaletteMode = "build";

  // Bytes load once per session, on mount — from the API, never a
  // builder-local copy. The engine guards the double-invoke itself.
  useEffect(() => {
    engine.ensureAssetTemplates();
  }, [engine]);

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

      <AssetsTab engine={engine} />

      <footer className={css.foot}>
        {mode === "build" ? "CLICK = PLACE AFTER SELECTION · APPENDS AT END" : "COMPOSE · EDIT THE MODULE INTERIOR"}
      </footer>
    </aside>
  );
}
