import {
  SEGMENT_COLOR_HUES,
  SEGMENT_COLORS,
  assetColorFamilyOf,
  type SegmentColorId,
} from "@dont-fall/shared";
import css from "./ColorPanel.module.css";
import { InspectorSection } from "../InspectorSection/InspectorSection";
import { Kicker } from "../Kicker/Kicker";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";

/**
 * One swatch's stripe pair, derived from the hue the paint aims at — the
 * same 45° stripes Character Select's COLOR tab wears, so paint reads as
 * paint in both apps. One source (the hue table), never a second palette to
 * drift.
 */
const stripesFor = (color: SegmentColorId): readonly [string, string] => {
  const h = SEGMENT_COLOR_HUES[color];
  return [`hsl(${h}, 75%, 62%)`, `hsl(${h}, 75%, 46%)`];
};

const stripeBackground = (color: SegmentColorId): string => {
  const [light, dark] = stripesFor(color);
  return `repeating-linear-gradient(45deg, ${light} 0 5px, ${light} 5px 10px, ${dark} 10px 15px, ${dark} 15px 20px)`;
};

/**
 * What paint the primary Segment wears: one of the 8 hues for a color-family
 * member — the 4 authored shades wear KayKit's own files, the 4 new hues
 * tint the piece flat (the character's paint/tint split, ADR 0113). Lone
 * looks (neutral pieces, traps) keep their authored bytes and get the hint
 * instead of the grid.
 */
export function ColorPanel({ engine }: { engine: BuilderEngine }) {
  useEngineVersion(engine);
  const primary = engine.primary;
  const segment = primary !== undefined ? engine.track[primary] : undefined;
  const paintable = segment !== undefined && (segment.color !== undefined || assetColorFamilyOf(segment.moduleId) !== null);
  const current = segment?.color;

  return (
    <InspectorSection id="color" title="COLOR" summary={current?.toUpperCase()}>
      <div className={css.root}>
        {segment === undefined ? (
          <p className={css.hint}>Select a Segment to repaint its colored parts.</p>
        ) : !paintable ? (
          <p className={css.hint}>Only color families repaint — this Asset keeps its authored look.</p>
        ) : (
          <div className={css.block}>
            <Kicker>PAINT{current ? ` · ${current.toUpperCase()}` : ""}</Kicker>
            <div className={css.grid} role="group" aria-label="segment paint">
              {SEGMENT_COLORS.map((color) => (
                <button key={color} type="button" title={color} aria-label={`paint ${color}`}
                  aria-pressed={current === color}
                  className={[css.swatch, current === color ? css.selected : ""].join(" ")}
                  style={{ background: stripeBackground(color) }}
                  onClick={() => engine.setSegmentColor(color)} />
              ))}
            </div>
            <p className={css.hint}>Four are KayKit&apos;s own shades, four tint the piece flat.</p>
          </div>
        )}
      </div>
    </InspectorSection>
  );
}
