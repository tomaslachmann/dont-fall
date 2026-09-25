import { useEffect, useState } from "react";
import css from "./TrackBuilderScreen.module.css";
import { CaptureBar } from "../../components/CaptureBar/CaptureBar";
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

  // Capture mode (ADR 0085) keeps this same tree — the keyed Viewport never
  // remounts across the switch, so the author's camera survives it — and only
  // swaps the chrome: everything hides, the fullscreen canvas stays, and the
  // CaptureBar floats over it.
  const previewing = engine.previewing;
  return (
    <div className={previewing ? css.capture : css.screen} data-tb-scope>
      {!previewing && (
        <header className={css.masthead}>
          <h1 className={css.wordmark}>Track Builder</h1>
          <span className={css.note}>DON'T FALL · TRACK AUTHORING TOOL</span>
        </header>
      )}

      <div className={previewing ? css.captureBody : css.body}>
        {!previewing && <ModulePalette engine={engine} />}

        <Viewport
          key="viewport"
          engine={engine}
          browseOpen={browseOpen && !previewing}
          onCloseBrowse={() => setBrowseOpen(false)}
        />

        {!previewing && engine.selection.length > 0 && (
          <div className={css.inspector}>
            <Inspector engine={engine} />
          </div>
        )}
      </div>

      {previewing ? (
        <CaptureBar engine={engine} />
      ) : (
        <Toolbar key={engine.loadedDraft?.id ?? engine.loadedTrack?.id ?? "unsaved"} engine={engine} onBrowse={toggleBrowse} />
      )}
    </div>
  );
}
