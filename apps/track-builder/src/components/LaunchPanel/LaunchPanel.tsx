import { LAUNCH_HEIGHT_MAX, LAUNCH_HEIGHT_MIN, LAUNCH_HEIGHT_PRESETS, launchHeightOf } from "@dont-fall/shared";
import css from "./LaunchPanel.module.css";
import { InspectorSection } from "../InspectorSection/InspectorSection";
import { Kicker } from "../Kicker/Kicker";
import { Stepper } from "../Stepper/Stepper";
import { UndoIcon } from "../icons/Icons";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";

const PRESETS = [
  { key: "low", height: LAUNCH_HEIGHT_PRESETS.low },
  { key: "medium", height: LAUNCH_HEIGHT_PRESETS.medium },
  { key: "high", height: LAUNCH_HEIGHT_PRESETS.high },
] as const;

/**
 * How high this Spring throws (CONTEXT.md: Spring, ADR 0069) — shown only on a
 * Segment whose Asset is one, because a Spring is a shape, never a switch.
 *
 * Presets and an exact number write the same `height` field; the presets are
 * shortcuts, not an enum in the data. Clearing returns the Spring to its
 * Asset's own default rather than switching it off.
 */
export function LaunchPanel({ engine }: { engine: BuilderEngine }) {
  useEngineVersion(engine);
  const primary = engine.primary;
  const segment = primary !== undefined ? engine.track[primary] : undefined;
  const def = segment ? engine.library[segment.moduleId]?.launch : undefined;
  if (!segment || !def) return null;

  const height = launchHeightOf(segment.launch, def);
  const authored = segment.launch !== undefined;

  return (
    <InspectorSection id="launch" title="LAUNCH" defaultOpen summary={`${height} m`}>
      <div className={css.root}>
        <div className={css.row}>
          <Kicker>HEIGHT · {LAUNCH_HEIGHT_MIN}—{LAUNCH_HEIGHT_MAX} m</Kicker>
          {authored && (
            <button type="button" className={css.reset} title={`back to this Asset's own ${def.height} m`}
              aria-label="reset launch height" onClick={() => engine.setSegmentLaunch(undefined)}>
              <UndoIcon size={12} />
            </button>
          )}
        </div>

        <div className={css.presets}>
          {PRESETS.map((preset) => (
            <button key={preset.key} type="button" title={`${preset.height} m`}
              className={[css.preset, Math.abs(preset.height - height) < 1e-6 ? css.presetOn : ""].join(" ")}
              onClick={() => engine.setSegmentLaunch(preset.height)}>
              {preset.key.toUpperCase()}
            </button>
          ))}
        </div>

        <Stepper value={height.toFixed(1)} onStep={(delta, fine) => engine.stepLaunchHeight(delta, fine)}
          onCommit={(committed) => engine.setSegmentLaunch(committed)} />

        <p className={css.hint}>
          Throws {height} m above its deck · aim it by tilting the piece{authored ? "" : ` · this Asset's own default`}.
        </p>
      </div>
    </InspectorSection>
  );
}
