import { Fragment } from "react";
import css from "./CourseStrip.module.css";
import { COURSE } from "../../lib/course.js";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";

/**
 * The run order at a glance (ADR 0068): START → 1 → 2 → … → FINISH, the same
 * marks the viewport draws over the Track. Every stop selects its Segment; a
 * missing Start or Finish is shown as the gap it is, not hidden.
 */
export function CourseStrip({ engine }: { engine: BuilderEngine }) {
  useEngineVersion(engine);
  if (engine.track.length === 0) return null;
  const { start, checkpoints, finishes } = engine.course;
  const selected = new Set(engine.selection);

  const stops = [
    start !== undefined ? (
      <button key="start" type="button" className={[css.pill, css.start, selected.has(start) ? css.on : ""].join(" ")}
        title="the Start — players spawn here" onClick={() => engine.select(start)}>
        <span className={css.glyph}>{COURSE.start.glyph}</span>START
      </button>
    ) : (
      <span key="start" className={[css.pill, css.missing].join(" ")}
        title="no Start — players spawn on the first Segment. Select any piece and make it the Start.">
        <span className={css.glyph}>{COURSE.start.glyph}</span>FIRST PIECE
      </span>
    ),
    ...checkpoints.map(({ index, order }) => {
      const stranded = engine.respawnOf(index)?.floor === undefined;
      return (
        <button key={`cp-${index}`} type="button"
          className={[css.badge, stranded ? css.stranded : "", selected.has(index) ? css.on : ""].join(" ")}
          title={stranded ? `Checkpoint ${order} — no floor to respawn on` : `Checkpoint ${order}`}
          onClick={() => engine.select(index)}>
          {order}
        </button>
      );
    }),
    ...(finishes.length > 0
      ? finishes.map((index) => (
          <button key={`finish-${index}`} type="button" className={[css.pill, css.finish, selected.has(index) ? css.on : ""].join(" ")}
            title="a finish sign — running under it qualifies" onClick={() => engine.select(index)}>
            <span className={css.checker} aria-hidden />FINISH
          </button>
        ))
      : [
          <span key="finish" className={[css.pill, css.missingFinish].join(" ")}
            title="no finish sign — a Race can't run on this Track (Survival still can)">
            <span className={css.glyph}>{COURSE.finish.glyph}</span>NO FINISH
          </span>,
        ]),
  ];

  return (
    <nav className={css.root} aria-label="run order">
      <span className={css.kicker}>RUN ORDER</span>
      <div className={css.stops}>
        {stops.map((stop, i) => (
          <Fragment key={i}>
            {i > 0 && <span className={css.link} aria-hidden />}
            {stop}
          </Fragment>
        ))}
      </div>
    </nav>
  );
}
