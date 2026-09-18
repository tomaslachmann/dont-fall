import { surfaceAttachmentOf, type ConveyorPreset } from "@dont-fall/shared";
import css from "./SurfacePanel.module.css";
import { InspectorSection } from "../InspectorSection/InspectorSection";
import { Kicker } from "../Kicker/Kicker";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import { Stepper } from "../Stepper/Stepper";
import { TrashIcon } from "../icons/Icons";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";

const PRESETS: { value: ConveyorPreset; label: string; title: string }[] = [
  { value: "slow", label: "SLOW", title: "2 u/s — a gentle nudge" },
  { value: "medium", label: "MEDIUM", title: "4 u/s — a brisk walkway" },
  { value: "fast", label: "FAST", title: "8 u/s — beats a run, holds you against it" },
];

const DECKS = [
  { value: "plain", label: "PLAIN", title: "the Module's own grip" },
  { value: "ice", label: "ICE", title: "near-zero grip, a weak take-off and a little slower" },
  { value: "mud", label: "MUD", title: "the slowest floor there is, and a jump it half swallows" },
  { value: "bounce", label: "BOUNCE", title: "an inflatable sheet — it throws back however hard you landed" },
] as const;

const BODIES = [
  { value: "placed", label: "PLACED", title: "nailed down — the Asset never moves" },
  { value: "prop", label: "PROP", title: "a body a Character can shove around" },
] as const;

const DECK_HINT: Record<(typeof DECKS)[number]["value"], string> = {
  plain: "One deck, one Surface — these are one choice, never a stack.",
  ice: "Near-zero grip · a weak take-off · a little off the top speed.",
  mud: "The slowest floor there is · half a jump · feet sink into the sheet.",
  bounce: "Throws you back as hard as you landed · and roughly doubles a jump.",
};

/** Radians (free, unnormalised) → display degrees in [0, 360). */
const toDisplayDegrees = (angle: number): string => {
  const degrees = (angle * 180) / Math.PI;
  return String(Math.round(((degrees % 360) + 360) % 360));
};

/**
 * What the primary Segment's deck is made of, and what it carries: ice, mud
 * (ADR 0066/0067 — one deck, one Surface, so they're one choice here, not two
 * ATTACH buttons that can both be on) and the belt that runs over it (ADR 0064).
 */
export function SurfacePanel({ engine }: { engine: BuilderEngine }) {
  useEngineVersion(engine);
  const primary = engine.primary;
  const segment = primary !== undefined ? engine.track[primary] : undefined;
  const conveyor = segment?.conveyor;
  const deck = (segment && surfaceAttachmentOf(segment)?.key) ?? "plain";
  // Why this Segment may not be a Prop, if it may not (ADR 0095) — the same
  // rule publish enforces, said here instead of at the point of refusal.
  const propLock =
    segment === undefined
      ? undefined
      : segment.motion !== undefined
        ? "A Moving Segment is authored movement, not physics — clear its Motion first."
        : segment.start === true
          ? "The Start has to stay where it is."
          : segment.checkpoint !== undefined
            ? "A Checkpoint gate has to stay where it is."
            : undefined;

  const summary = [
    segment?.prop === true ? "PROP" : undefined,
    deck === "plain" ? undefined : deck.toUpperCase(),
    conveyor ? `BELT · ${PRESETS.find((p) => p.value === conveyor.preset)!.label}` : undefined,
  ].filter(Boolean).join(" · ");

  return (
    <InspectorSection id="surface" title="SURFACE" summary={summary === "" ? undefined : summary}>
      <div className={css.root}>
        {segment === undefined ? (
          <p className={css.hint}>Select a Segment to change what its deck is made of.</p>
        ) : (
          <>
            <div className={css.block}>
              <Kicker>BODY</Kicker>
              {propLock === undefined ? (
                <SegmentedControl shape="pill" size="sm" tone="ink" value={segment.prop === true ? "prop" : "placed"}
                  items={[...BODIES]} onChange={(next) => engine.setSegmentProp(next === "prop")} />
              ) : (
                <p className={css.hint}>{propLock}</p>
              )}
              <p className={css.hint}>
                {segment.prop === true
                  ? "A body physics owns · it falls, it is shoved, and it has no deck of its own."
                  : "Placed pieces are scenery a Character runs into · a Prop is one it moves."}
              </p>
            </div>

            {segment.prop === true ? null : (
            <div className={css.block}>
              <Kicker>DECK</Kicker>
              <SegmentedControl shape="pill" size="sm" tone="ink" value={deck} items={[...DECKS]}
                onChange={(next) => engine.setSegmentSurface(next === "plain" ? undefined : next)} />
              <p className={css.hint}>{DECK_HINT[deck]}</p>
            </div>
            )}

            {segment.prop === true ? null : (
            <div className={css.block}>
              <div className={css.row}>
                <div className={css.grow}>
                  <Kicker>BELT{conveyor ? ` · ${PRESETS.find((p) => p.value === conveyor.preset)!.label}` : ""}</Kicker>
                </div>
                {conveyor && (
                  <button type="button" className={css.detach} title="detach the belt" aria-label="detach belt"
                    onClick={() => engine.setSegmentConveyor(undefined)}><TrashIcon /></button>
                )}
              </div>

              {conveyor ? (
                <>
                  <SegmentedControl shape="pill" size="sm" tone="ink" value={conveyor.preset} items={PRESETS}
                    onChange={(preset) => engine.setSegmentConveyor({ preset, angle: conveyor.angle })} />
                  <div className={css.row}>
                    <Kicker>ANGLE</Kicker>
                    <div className={css.grow}>
                      <Stepper value={toDisplayDegrees(conveyor.angle)}
                        onStep={(delta, fine) => engine.stepConveyorAngle(delta, fine)}
                        onCommit={(degrees) => engine.setSegmentConveyor({ preset: conveyor.preset, angle: (degrees * Math.PI) / 180 })} />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <button type="button" className={css.attach}
                    title="attach a belt — the whole asset carries whoever stands on it"
                    onClick={() => engine.setSegmentConveyor({ preset: "medium", angle: 0 })}>ATTACH BELT</button>
                  <p className={css.hint}>0° runs toward the exit · with it you run faster, against it slower.</p>
                </>
              )}
            </div>
            )}
          </>
        )}
      </div>
    </InspectorSection>
  );
}
