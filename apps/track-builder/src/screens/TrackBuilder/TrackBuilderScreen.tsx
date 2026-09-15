import { useEffect, useState } from "react";
import css from "./TrackBuilderScreen.module.css";
import { ModulePalette } from "../../components/ModulePalette/ModulePalette";
import { Viewport } from "../../components/Viewport/Viewport";
import { Inspector } from "../../components/Inspector/Inspector";
import { Toolbar } from "../../components/Toolbar/Toolbar";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";

/** Five regions: A palette · B viewport · C transform + D motion (inspector) · E toolbar. The engine owns every fact; this only subscribes, and owns the loop/keyboard lifetimes. */
export function TrackBuilderScreen({ engine }: { engine: BuilderEngine }) {
  useEngineVersion(engine);
  const [browseOpen, setBrowseOpen] = useState(false);

  useEffect(() => {
    engine.startLoop();
    return () => engine.stopLoop();
  }, [engine]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (engine.handleKeyDown(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);

  const toggleBrowse = (): void => {
    setBrowseOpen((open) => {
      if (!open) void engine.fetchTrackList();
      return !open;
    });
  };

  return (
    <div className={css.screen} data-tb-scope>
      <header className={css.masthead}>
        <h1 className={css.wordmark}>Track Builder</h1>
        <span className={css.note}>DON'T FALL · TRACK AUTHORING TOOL</span>
      </header>

      <div className={css.body}>
        <ModulePalette engine={engine} />

        <Viewport engine={engine} browseOpen={browseOpen} onCloseBrowse={() => setBrowseOpen(false)} />

        {engine.selection.length > 0 && (
          <div className={css.inspector}>
            <Inspector engine={engine} />
          </div>
        )}
      </div>

      <Toolbar key={engine.loadedTrack?.id ?? "draft"} engine={engine} onBrowse={toggleBrowse} />
    </div>
  );
}
