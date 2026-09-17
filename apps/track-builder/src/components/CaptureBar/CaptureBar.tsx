import css from "./CaptureBar.module.css";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";

/**
 * The Thumbnail capture's only UI (ADR 0085): one floating bar over the
 * fullscreen bare-Track viewport — a framing hint, CREATE PREVIEW
 * (capture-and-save) and CANCEL. Failures surface here too, since the
 * Toolbar (and its status) is unmounted while capturing.
 */
export function CaptureBar({ engine }: { engine: BuilderEngine }) {
  useEngineVersion(engine);
  const failed = engine.status.kind === "error";
  return (
    <div className={css.bar} role="dialog" aria-label="Capture the save thumbnail">
      <span className={css.hint}>ORBIT · ZOOM · PAN TO FRAME THE TRACK</span>
      {failed && <span className={css.error}>{engine.status.text}</span>}
      <div className={css.actions}>
        <button type="button" className={css.cancel} onClick={() => engine.cancelPreviewCapture()}>
          CANCEL
        </button>
        <button type="button" className={css.capture} onClick={() => void engine.confirmPreviewCapture()}>
          CREATE PREVIEW
        </button>
      </div>
    </div>
  );
}
