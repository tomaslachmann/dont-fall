import css from "./Transport.module.css";
import { PauseIcon, PlayIcon } from "../icons/Icons";
import type { BuilderEngine } from "../../engine.js";
import { useEngineClock, useEngineVersion } from "../../hooks/useEngine.js";

/** One clock — every motion on this track plays against it. Play is white plastic, not accent: Playtest is the only accent button on screen. */
export function Transport({ engine }: { engine: BuilderEngine }) {
  const seconds = useEngineClock(engine);
  useEngineVersion(engine);
  const playing = engine.playing;
  const impactOn = engine.tintVisible;
  const progress = ((seconds % 60) / 60) * 100;

  return (
    <div className={css.root}>
      <div className={css.row}>
        <button type="button" className={css.btn} aria-label={playing ? "pause" : "play"}
          title={playing ? "pause the Motion clock" : "play the Motion clock"}
          onClick={() => engine.setPlaying(!playing)}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button type="button" className={css.btn} aria-label="restart" title="restart the Motion clock"
          onClick={() => engine.restartClock()}>⟲</button>

        <div className={css.track} title="scrub the Motion clock">
          <span className={css.fill} style={{ width: progress + "%" }} />
          <input className={css.scrub} type="range" min={0} max={60} step={0.01} value={seconds % 60}
            aria-label="motion time"
            onChange={(e) => engine.setClockSeconds(Number(e.target.value))} />
        </div>

        <span className={css.time} data-df-numeric>{seconds.toFixed(2)} s</span>

        <button type="button" className={[css.impact, impactOn ? css.impactOn : ""].join(" ")}
          title="green pushes or carries · yellow staggers · red knocks down"
          onClick={() => engine.setTintVisible(!impactOn)}>
          <span className={css.impactBox}>{impactOn ? "✓" : ""}</span>
          <span className={css.impactLabel}>IMPACT</span>
        </button>
      </div>
      <span className={css.caption}>ONE CLOCK · EVERY MOTION ON THIS TRACK PLAYS AGAINST IT</span>
    </div>
  );
}
