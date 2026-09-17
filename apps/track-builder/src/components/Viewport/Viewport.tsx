import { useEffect, useLayoutEffect, useRef, type SyntheticEvent } from "react";
import css from "./Viewport.module.css";
import { BrowsePanel } from "../BrowsePanel/BrowsePanel";
import { Transport } from "../Transport/Transport";
import { HintBar } from "../HintBar/HintBar";
import { ImpactLegend } from "../ImpactLegend/ImpactLegend";
import { CourseStrip } from "../CourseStrip/CourseStrip";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";

interface Props {
  engine: BuilderEngine;
  browseOpen: boolean;
  onCloseBrowse: () => void;
}

/** Region B. Owns the 3D canvas (an imperative island, like the client's game) and the four floating overlays. */
export function Viewport({ engine, browseOpen, onCloseBrowse }: Props) {
  useEngineVersion(engine);
  const mountRef = useRef<HTMLDivElement | null>(null);
  // Capture mode frames the bare Track (ADR 0085): no overlays, no banners —
  // the CaptureBar is the only UI, and it lives outside this region.
  const previewing = engine.previewing;

  useEffect(() => {
    if (!mountRef.current) return;
    engine.attachViewport(mountRef.current);
    return () => engine.detachViewport();
  }, [engine]);

  // Capture mode swaps the layout under a mounted canvas (ADR 0085) — the box
  // resizes with no window resize, so re-fit the renderer once the new layout
  // has landed, before paint. A no-op until the viewport is attached.
  useLayoutEffect(() => {
    engine.resizeViewport();
  }, [engine, previewing]);

  const empty = engine.track.length === 0;
  const picking = engine.picking;
  // Overlay clicks must never reach the canvas pick below (a Button inside an
  // overlay is not "clicked empty space").
  const swallow = (e: SyntheticEvent): void => e.stopPropagation();

  return (
    <div className={[css.root, picking ? css.picking : ""].join(" ")}
      onPointerDown={(e) => engine.viewportPointerDown(e.clientX, e.clientY)}
      onClick={(e) => engine.viewportClick(e.clientX, e.clientY, e.shiftKey)}>
      <div ref={mountRef} className={css.mount} />

      {!previewing && empty && (
        <div className={css.empty}>
          <span className={css.emptyPlate} />
          <h3 className={css.emptyTitle}>Empty track</h3>
          <p className={css.emptyBody}>PICK A MODULE ON THE LEFT TO DROP THE FIRST SEGMENT</p>
        </div>
      )}

      {!previewing && picking && (
        <div className={css.pickBanner}>
          <span className={css.pickGlyph}>⌖</span>
          {engine.pickingRespawn
            ? "PICKING RESPAWN · CLICK THE PLATFORM TO STAND ON · ESC CANCELS"
            : "PICKING PIVOT · CLICK THE MODEL · ESC CANCELS"}
        </div>
      )}

      {!previewing && (
        <>
          <div className={css.slotBrowse} onClick={swallow} onPointerDown={swallow}>
            {browseOpen && (
              <BrowsePanel tracks={engine.browseTracks} state={engine.browseState}
                activeId={engine.loadedTrack?.id ?? null}
                onClose={onCloseBrowse}
                onSelect={(id) => {
                  onCloseBrowse();
                  void engine.loadTrackById(id);
                }} />
            )}
          </div>
          <div className={css.slotTransport} onClick={swallow} onPointerDown={swallow}>
            <Transport engine={engine} />
          </div>
          <div className={css.slotCourse} onClick={swallow} onPointerDown={swallow}>
            <CourseStrip engine={engine} />
          </div>
          <div className={css.slotHint} onClick={swallow} onPointerDown={swallow}>
            <HintBar />
          </div>
          <div className={css.slotLegend}>
            <ImpactLegend />
          </div>
        </>
      )}
    </div>
  );
}
