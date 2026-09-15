import css from "./Inspector.module.css";
import { TransformPanel } from "../TransformPanel/TransformPanel";
import { MotionPanelView } from "../MotionPanel/MotionPanelView";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";

/** Regions C + D in one floating card, its own scroll, full viewport height. */
export function Inspector({ engine }: { engine: BuilderEngine }) {
  useEngineVersion(engine);
  const count = engine.selection.length;
  const primary = engine.primary;
  const segment = primary !== undefined ? engine.track[primary] : undefined;
  const multi = count > 1;

  const sub = segment
    ? multi
      ? "group gizmo on synthetic pivot · moves rigidly"
      : `#${primary} ${segment.moduleId}${segment.manuallyPlaced ? " · manually placed" : ""} · seg ${String(primary! + 1).padStart(2, "0")} of ${engine.track.length}`
    : "";

  return (
    <section className={css.root}>
      <header className={css.head}>
        <div className={css.headText}>
          <h2 className={css.title}>Selected</h2>
          <span className={css.sub}>{sub}</span>
        </div>
        <span className={css.count}>{count} SEG{count > 1 ? "S" : ""}</span>
      </header>

      <TransformPanel engine={engine} />
      <MotionPanelView engine={engine} />
    </section>
  );
}
