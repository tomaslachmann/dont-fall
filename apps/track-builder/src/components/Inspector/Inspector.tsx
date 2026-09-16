import css from "./Inspector.module.css";
import { TransformPanel } from "../TransformPanel/TransformPanel";
import { MotionPanelView } from "../MotionPanel/MotionPanelView";
import { SurfacePanel } from "../SurfacePanel/SurfacePanel";
import { LaunchPanel } from "../LaunchPanel/LaunchPanel";
import { CoursePanel } from "../CoursePanel/CoursePanel";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";

/**
 * Regions C + D in one floating card: a fixed header over a scrolling stack of
 * foldable sections, one per panel.
 *
 * Every panel renders its own `InspectorSection`, summary included — the card
 * only decides their order. That is what keeps the inspector finite: the next
 * property to land costs one folded header here, not another always-open block
 * pushing Motion off the bottom of a card that used to clip what overflowed.
 */
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

      <div className={css.sections}>
        <TransformPanel engine={engine} />
        <CoursePanel engine={engine} />
        <MotionPanelView engine={engine} />
        <LaunchPanel engine={engine} />
        <SurfacePanel engine={engine} />
      </div>
    </section>
  );
}
