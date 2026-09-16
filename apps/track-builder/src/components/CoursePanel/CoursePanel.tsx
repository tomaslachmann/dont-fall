import { hasMotion, type Segment } from "@dont-fall/shared";
import { InspectorSection } from "../InspectorSection/InspectorSection";
import { Kicker } from "../Kicker/Kicker";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import { TrashIcon } from "../icons/Icons";
import css from "./CoursePanel.module.css";
import { COURSE, gateRoleOf, motionLockReason } from "../../lib/course.js";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";

/**
 * Region C, right under the transform (ADR 0068): what this Segment is on the
 * course. Any piece can be the Start; a hoop or an arch can be a numbered
 * Checkpoint with a respawn spot; a finish sign always finishes.
 */
export function CoursePanel({ engine }: { engine: BuilderEngine }) {
  useEngineVersion(engine);
  const primary = engine.primary;
  const segment = primary !== undefined ? engine.track[primary] : undefined;

  if (primary === undefined || !segment || engine.selection.length > 1) {
    return (
      <InspectorSection id="course" title="COURSE">
        <div className={css.root}>
          <p className={css.hint}>
            {engine.selection.length > 1 ? "Single select only." : "Select a piece to make it the Start, a Checkpoint or the finish."}
          </p>
        </div>
      </InspectorSection>
    );
  }

  const role = gateRoleOf(segment, engine.library);
  const moving = hasMotion(segment.motion);
  const locked = motionLockReason(segment, engine.library);
  const checkpointCount = engine.course.checkpoints.length;

  return (
    <InspectorSection id="course" title="COURSE" summary={courseSummary(segment, role)}>
      <div className={css.root}>
        {/* ---- Start: any piece ---- */}
        {segment.start ? (
          <div className={[css.card, css.startCard].join(" ")}>
            <span className={[css.mark, css.startMark].join(" ")}>{COURSE.start.glyph}</span>
            <div className={css.cardText}>
              <span className={css.cardTitle}>START</span>
              <span className={css.cardSub}>Players spawn on this deck, facing its arrow.</span>
            </div>
            <button type="button" className={css.remove} title="no longer the Start" aria-label="remove start"
              onClick={() => engine.setSegmentStart(false)}><TrashIcon /></button>
          </div>
        ) : (
          <button type="button" className={css.make} disabled={moving}
            title={moving ? "a Start stays still — switch its Motion off first" : "players spawn here — moves the Start from wherever it was"}
            onClick={() => engine.setSegmentStart(true)}>
            <span className={[css.makeMark, css.startMark].join(" ")}>{COURSE.start.glyph}</span>
            {engine.course.start !== undefined ? "MOVE START HERE" : "MAKE START"}
          </button>
        )}

        {/* ---- Checkpoint: hoops and arches ---- */}
        {role === "checkpoint" &&
          (segment.checkpoint ? (
            <CheckpointCard engine={engine} index={primary} order={segment.checkpoint.order} of={checkpointCount}
              picked={segment.checkpoint.respawn !== undefined} />
          ) : (
            <button type="button" className={css.make} disabled={moving}
              title={moving ? "a Checkpoint stays still — switch its Motion off first" : "running or jumping through it sets the Respawn"}
              onClick={() => engine.setSegmentCheckpoint(true)}>
              <span className={[css.makeMark, css.checkpointMark].join(" ")}>{checkpointCount + 1}</span>
              MAKE CHECKPOINT {checkpointCount + 1}
            </button>
          ))}

        {/* ---- Finish: finish signs, always ---- */}
        {role === "finish" && (
          <div className={[css.card, css.finishCard].join(" ")}>
            <span className={[css.mark, css.finishMark].join(" ")} aria-hidden />
            <div className={css.cardText}>
              <span className={css.cardTitle}>FINISH</span>
              <span className={css.cardSub}>Always — running under it qualifies.</span>
            </div>
          </div>
        )}

        {role === undefined && !segment.start && (
          <p className={css.hint}>Hoops and arches can be Checkpoints · finish signs always finish.</p>
        )}
        {locked && <p className={css.locked}><span className={css.lockGlyph}>⏸</span>MOTION OFF · {locked}</p>}
      </div>
    </InspectorSection>
  );
}

/** What this piece is on the course, read off the folded section header. */
const courseSummary = (segment: Segment, role: "checkpoint" | "finish" | undefined): string | undefined => {
  const roles = [
    segment.start === true ? COURSE.start.word : undefined,
    role === "checkpoint" && segment.checkpoint ? `${COURSE.checkpoint.word} ${segment.checkpoint.order}` : undefined,
    role === "finish" ? COURSE.finish.word : undefined,
  ].filter(Boolean);
  return roles.length === 0 ? undefined : roles.join(" · ");
};

function CheckpointCard({ engine, index, order, of, picked }: {
  engine: BuilderEngine;
  index: number;
  order: number;
  of: number;
  picked: boolean;
}) {
  const stranded = engine.respawnOf(index)?.floor === undefined;
  return (
    <div className={[css.card, css.checkpointCard, stranded ? css.strandedCard : ""].join(" ")}>
      <div className={css.cardRow}>
        <span className={[css.mark, css.checkpointMark, stranded ? css.strandedMark : ""].join(" ")}>{order}</span>
        <div className={css.cardText}>
          <span className={css.cardTitle}>CHECKPOINT</span>
          <span className={css.cardSub}>Run or jump through it · either way.</span>
        </div>
        <button type="button" className={css.remove} title="no longer a Checkpoint — the rest renumber" aria-label="remove checkpoint"
          onClick={() => engine.setSegmentCheckpoint(false)}><TrashIcon /></button>
      </div>

      <div className={css.orderRow}>
        <Kicker>ORDER</Kicker>
        <div className={css.order}>
          <button type="button" className={css.orderBtn} disabled={order <= 1} aria-label="earlier"
            title="one earlier — swaps with the Checkpoint before it" onClick={() => engine.stepCheckpointOrder(-1)}>‹</button>
          <span className={css.orderValue} data-df-numeric>
            {order}<span className={css.orderOf}> / {of}</span>
          </span>
          <button type="button" className={css.orderBtn} disabled={order >= of} aria-label="later"
            title="one later — swaps with the Checkpoint after it" onClick={() => engine.stepCheckpointOrder(1)}>›</button>
        </div>
      </div>

      <div className={css.respawnBlock}>
        <Kicker>RESPAWN</Kicker>
        <SegmentedControl shape="pill" size="sm" tone="ink"
          value={engine.pickingRespawn || picked ? "picked" : "under"}
          onChange={(where) => (where === "under" ? engine.resetCheckpointRespawn() : engine.requestRespawnPick())}
          items={[
            { value: "under", label: "IN FRONT", title: "on the floor just in front of the gate, the side runners arrive from" },
            { value: "picked", label: engine.pickingRespawn ? "⌖ CLICK A PLATFORM…" : picked ? "⌖ PICKED · REPICK" : "⌖ PICK A SPOT", title: "click the platform to stand on" },
          ]} />
        {stranded && (
          <p className={css.problem}>
            <span className={css.problemGlyph}>!</span>
            No floor in front of or behind this gate — pick a spot, or it isn't a Checkpoint.
          </p>
        )}
      </div>
    </div>
  );
}
