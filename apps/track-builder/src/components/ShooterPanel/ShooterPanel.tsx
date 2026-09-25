import { shooterDefOf, shooterShotsInFlight, SHOOTER_MAX_IN_FLIGHT, type ShooterAmmo, type ShooterTiming } from "@dont-fall/shared";
import css from "./ShooterPanel.module.css";
import { InspectorSection } from "../InspectorSection/InspectorSection";
import { Kicker } from "../Kicker/Kicker";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import { Stepper } from "../Stepper/Stepper";
import { UndoIcon } from "../icons/Icons";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";

/** What it fires (ADR 0127): its own balls, or Bombs, lit as they leave. */
const AMMO = [
  { value: "ball", label: "BALL", title: "a ball that knocks down what it reaches, and rolls on" },
  { value: "bomb", label: "BOMB", title: "a lit bomb that knocks down what it reaches, then goes off" },
] as const;

/**
 * How often this cannon fires, how fast and how long its balls live
 * (CONTEXT.md: Shooter, ADR 0119) — shown only on a Segment whose Asset is
 * one, because a cannon is a shape, never a switch.
 *
 * Where the muzzle is and how wide it sweeps belong to the Asset. What an
 * author sets here decides how many balls are in the air at once, which is
 * shown rather than left to be discovered: the three numbers multiply.
 */
export function ShooterPanel({ engine }: { engine: BuilderEngine }) {
  useEngineVersion(engine);
  const primary = engine.primary;
  const segment = primary !== undefined ? engine.track[primary] : undefined;
  const def = segment ? engine.library[segment.moduleId]?.shooter : undefined;
  if (!segment || !def) return null;

  const ammo: ShooterAmmo = segment.shooter?.ammo ?? "ball";
  const period = segment.shooter?.periodSeconds ?? def.periodSeconds;
  const speed = segment.shooter?.speed ?? def.speed;
  // A Shooter of bombs burns their own fuse unless it has a life of its own (ADR 0127).
  const life = shooterDefOf(def, segment.shooter).lifeSeconds;
  const authored = segment.shooter !== undefined;
  const degrees = (radians: number) => Math.round((radians * 180) / Math.PI);
  // Each axis on its own: a cannon can be held still side to side and still
  // sweep up and down, and the two run on their own clocks (ADR 0119).
  const yawDegrees = segment.shooter?.yawDegrees ?? degrees(def.yaw.amplitude);
  const yawSeconds = segment.shooter?.yawSeconds ?? def.yaw.period;
  const pitchDegrees = segment.shooter?.pitchDegrees ?? degrees(def.pitch.amplitude);
  const pitchSeconds = segment.shooter?.pitchSeconds ?? def.pitch.period;
  const inFlight = shooterShotsInFlight({ ...def, periodSeconds: period, lifeSeconds: life });
  const set = (next: Partial<ShooterTiming>) =>
    engine.setSegmentShooter({ ammo, periodSeconds: period, speed, lifeSeconds: life, yawDegrees, yawSeconds, pitchDegrees, pitchSeconds, ...next });
  // Changing what it fires starts that ammunition's own life over: a ball's
  // five seconds of rolling is not a bomb's fuse (ADR 0127).
  const setAmmo = (next: ShooterAmmo) =>
    set({ ammo: next, lifeSeconds: shooterDefOf(def, { ammo: next }).lifeSeconds });

  return (
    <InspectorSection id="shooter" title="SHOOTER" defaultOpen summary={`${ammo === "bomb" ? "bombs" : "balls"} every ${period.toFixed(1)} s`}>
      <div className={css.root}>
        <Kicker>AMMO</Kicker>
        <SegmentedControl shape="pill" size="sm" tone="ink" value={ammo} items={[...AMMO]}
          onChange={(next) => setAmmo(next as ShooterAmmo)} />

        <div className={css.row}>
          <Kicker>EVERY · seconds</Kicker>
          {authored && (
            <button type="button" className={css.reset} title="back to this Asset's own numbers"
              aria-label="reset shooter" onClick={() => engine.setSegmentShooter(undefined)}>
              <UndoIcon size={12} />
            </button>
          )}
        </div>
        <Stepper value={period.toFixed(1)} onStep={(delta, fine) => engine.stepShooter("periodSeconds", delta, fine)}
          onCommit={(committed) => set({ periodSeconds: committed })} />

        <Kicker>SPEED · units per second</Kicker>
        <Stepper value={speed.toFixed(1)} onStep={(delta, fine) => engine.stepShooter("speed", delta, fine)}
          onCommit={(committed) => set({ speed: committed })} />

        <Kicker>{ammo === "bomb" ? "FUSE · seconds from the shot" : "BALL LASTS · seconds"}</Kicker>
        <Stepper value={life.toFixed(1)} onStep={(delta, fine) => engine.stepShooter("lifeSeconds", delta, fine)}
          onCommit={(committed) => set({ lifeSeconds: committed })} />

        <Kicker>SWEEP SIDE TO SIDE · degrees, 0 holds it still</Kicker>
        <Stepper value={yawDegrees.toFixed(0)} onStep={(delta, fine) => engine.stepShooter("yawDegrees", delta, fine)}
          onCommit={(committed) => set({ yawDegrees: committed })} />
        <Kicker>…over · seconds</Kicker>
        <Stepper value={yawSeconds.toFixed(1)} onStep={(delta, fine) => engine.stepShooter("yawSeconds", delta, fine)}
          onCommit={(committed) => set({ yawSeconds: committed })} />

        <Kicker>SWEEP UP AND DOWN · degrees, 0 holds it still</Kicker>
        <Stepper value={pitchDegrees.toFixed(0)} onStep={(delta, fine) => engine.stepShooter("pitchDegrees", delta, fine)}
          onCommit={(committed) => set({ pitchDegrees: committed })} />
        <Kicker>…over · seconds</Kicker>
        <Stepper value={pitchSeconds.toFixed(1)} onStep={(delta, fine) => engine.stepShooter("pitchSeconds", delta, fine)}
          onCommit={(committed) => set({ pitchSeconds: committed })} />

        <p className={css.hint}>
          {inFlight} {ammo === "bomb" ? "bomb" : "ball"}{inFlight === 1 ? "" : "s"} in the air at once
          {inFlight > SHOOTER_MAX_IN_FLIGHT ? ` · more than ${SHOOTER_MAX_IN_FLIGHT}, which publish refuses` : ""}
          {ammo === "bomb"
            ? " · each leaves lit, knocks down what it hits, and goes off when its fuse runs out — anyone can catch one and throw it back"
            : " · a spent ball keeps rolling, it is never taken away by hitting someone"}
          {authored ? "" : " · this Asset's own defaults"}.
        </p>
      </div>
    </InspectorSection>
  );
}
