import { segmentScale } from "@dont-fall/shared";
import css from "./TransformPanel.module.css";
import { InspectorSection } from "../InspectorSection/InspectorSection";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import { Stepper } from "../Stepper/Stepper";
import { Kicker } from "../Kicker/Kicker";
import { UndoIcon, RedoIcon, DuplicateIcon, TrashIcon } from "../icons/Icons";
import type { BuilderEngine, GizmoMode } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";

const SIZES = [0.25, 0.5, 1, 1.5, 2, 3, 4];
const TOOL_BY_MODE: Record<GizmoMode, "move" | "rotate" | "scale"> = {
  translate: "move",
  rotate: "rotate",
  scale: "scale",
};
const MODE_BY_TOOL = { move: "translate", rotate: "rotate", scale: "scale" } as const;

/** Region C. Transform, dupe, delete and size stay live for groups too. */
export function TransformPanel({ engine }: { engine: BuilderEngine }) {
  useEngineVersion(engine);
  const primary = engine.primary;
  const scale = primary !== undefined ? segmentScale(engine.track[primary]!) : 1;
  const tool = TOOL_BY_MODE[engine.gizmoMode];

  return (
    <InspectorSection id="transform" title="TRANSFORM" defaultOpen
      summary={`${tool.toUpperCase()} · ${engine.rotateAxis.toUpperCase()} · ${scale}×`}>
      <div className={css.root}>
        <SegmentedControl value={tool}
          onChange={(picked) => engine.setGizmoMode(MODE_BY_TOOL[picked])}
          items={[
            { value: "move", label: "MOVE" },
            { value: "rotate", label: "ROTATE" },
            { value: "scale", label: "SCALE" },
          ]} />

        <div className={css.quick}>
          <button type="button" className={css.qBtn} title="rotate +90° (yaw)"
            onClick={() => engine.rotateSelected90(1)}><UndoIcon size={13} />90°</button>
          <button type="button" className={css.qBtn} title="rotate −90° (yaw)"
            onClick={() => engine.rotateSelected90(-1)}><RedoIcon size={13} />90°</button>
          <button type="button" className={css.qBtn} title="duplicate"
            onClick={() => engine.duplicateSelected()}><DuplicateIcon /></button>
          <button type="button" className={[css.qBtn, css.quiet].join(" ")}
            title="delete — lives with undo/redo in the toolbar"
            onClick={() => engine.deleteSelected()}><TrashIcon /></button>
        </div>

        <div className={css.axisRow}>
          <Kicker>AXIS</Kicker>
          <div className={css.axisControl}>
            <SegmentedControl shape="pill" size="sm" tone="ink" value={engine.rotateAxis}
              onChange={(axis) => engine.setRotateAxis(axis)}
              items={[
                { value: "yaw", label: "YAW" },
                { value: "pitch", label: "PITCH" },
                { value: "roll", label: "ROLL" },
              ]} />
          </div>
        </div>

        <div className={css.sizeBlock}>
          <Kicker>SIZE · 0.25—4</Kicker>
          <div className={css.sizes}>
            {SIZES.map((s) => (
              <button key={s} type="button" title={`${s}× the file's size`}
                className={[css.sizeBtn, Math.abs(s - scale) < 1e-6 ? css.sizeOn : ""].join(" ")}
                onClick={() => engine.scaleSelected(s)}>{s}</button>
            ))}
          </div>
          <Stepper value={scale.toFixed(2)} onStep={(delta, fine) => engine.stepScale(delta, fine)}
            onCommit={(committed) => engine.scaleSelected(committed)} />
        </div>
      </div>
    </InspectorSection>
  );
}
