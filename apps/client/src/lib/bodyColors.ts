import { DEFAULT_BODY_COLOR } from "@dont-fall/shared";

/**
 * The body colors as stripe pairs — the flat tint a bean wears when it has
 * no skin on. In `color` id order, base (`BASE_BODY_COLOR_ID`) last: its
 * stripes are BLIP's own authored cream. Character Select's swatches and every
 * avatar's disc (ADR 0110) read the same list.
 */
export const BODY_COLOR_STRIPES: ReadonlyArray<readonly [string, string]> = [
  ["#FFB4DC", "#FF8AC6"],
  ["#7FE3FF", "#3FC4FF"],
  ["#B6F5A0", "#7FE07F"],
  ["#FFD9A0", "#FFB25E"],
  ["#D9C9F5", "#C4AFEF"],
  ["#FFC0C0", "#FF9E9E"],
  ["#C9F0FF", "#A8E4FF"],
  ["#F3DFC3", "#D3C2AA"],
];

/** A color id's stripe pair — the default bean's for no color or one out of range. */
export const stripesFor = (color: number | null | undefined): readonly [string, string] =>
  BODY_COLOR_STRIPES[color ?? DEFAULT_BODY_COLOR] ?? BODY_COLOR_STRIPES[DEFAULT_BODY_COLOR]!;
