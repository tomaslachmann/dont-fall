/**
 * A Conveyor chevron strip's layout math (ADR 0064) — pure numbers, no
 * three.js: the game scene and the Track builder share this so the belt an
 * author places is pixel-geometry-identical to the belt a player runs on.
 * Both renderers wrap it in their own meshes/materials and drive `phaseUnits`
 * from their own clock (sim time in the game, the motion-preview clock in
 * the builder).
 */
export interface StripLayout {
  /** Chevron scale: 1 on roomy decks, shrunk (never below 0.4) on tiny ones instead of overcrowding them. */
  unit: number;
  /**
   * Along-flow pitch between chevrons — `CHEVRON_SPACING` stretched so the
   * grid spans the deck edge to edge (never shrunk: the counts below are
   * fitted against the base pitch first).
   */
  spacing: number;
  /**
   * Across-flow pitch between rows — `CHEVRON_ROW_GAP` stretched so the
   * grid spans the deck edge to edge.
   */
  rowGap: number;
  /** Chevrons per row (1–6). */
  perRow: number;
  /** Rows across the flow (1–4). */
  rows: number;
  /**
   * The march cycle length: the deck's full flow extent. The strip copies
   * the deck edge to edge, so chevrons fold over the deck's own edge —
   * never dive through its top mid-surface.
   */
  span: number;
  /** Rest-pose half-travel: chevron 0 sits at +`edge`, the last at −`edge`. */
  edge: number;
  /** Lateral (x) offsets per row, centred on the flow axis. */
  laterals: number[];
}

/** Chevron spacing along the flow, and row pitch across it, at full size — the pitch the counts fit against before the stretch. */
export const CHEVRON_SPACING = 1.6;
export const CHEVRON_ROW_GAP = 1.5;

/**
 * How many chevrons fit the deck's flow (`halfL`) × lateral (`halfW`)
 * half-extents — the deck rect projected onto the flow and its
 * perpendicular (a free-angle belt runs diagonally across its deck as
 * readily as along it; the callers own that projection).
 *
 * The counts fit against the base pitch (so a 12×12 deck still caps
 * at 6×4 chevrons), then the pitch stretches to span the deck edge to
 * edge: the strip's own ends land exactly on the deck's flow edges. On a
 * capped deck that reads sparse, deliberately — the whole Segment carries
 * whoever stands on it, so the whole Segment reads as belt rather than a
 * marching patch in its middle.
 */
export const stripLayout = (halfL: number, halfW: number): StripLayout => {
  const unit = Math.min(1, Math.max(0.4, Math.min(halfL, halfW)));
  const spacing = CHEVRON_SPACING * unit;
  const rowGap = CHEVRON_ROW_GAP * unit;
  const perRow = Math.min(6, Math.max(1, Math.floor((halfL * 2) / spacing)));
  const rows = Math.min(4, Math.max(1, Math.floor((halfW * 2) / rowGap)));
  const span = halfL * 2;
  const stretched = span / perRow;
  const stretchedRow = (halfW * 2) / rows;
  const edge = (span - stretched) / 2;
  const laterals: number[] = [];
  for (let row = 0; row < rows; row += 1) laterals.push((row - (rows - 1) / 2) * stretchedRow);
  return { unit, spacing: stretched, rowGap: stretchedRow, perRow, rows, span, edge, laterals };
};

/**
 * Chevron `marchIndex`'s along-flow position (local −Z is the flow) at
 * `phaseUnits` units marched (`tSeconds × beltSpeed` — the strip marches at
 * true belt speed). Travel stays within ±`span`/2: the half-spacing phase
 * offset centres both the rest pose and the travel — without it the travel
 * sits half a spacing off-centre and chevrons march past small decks'
 * edges. One spacing of wrap gap keeps the rhythm even, no bunching at the
 * wrap point.
 */
export const marchZ = (layout: StripLayout, marchIndex: number, phaseUnits: number): number => {
  const { spacing, span, edge } = layout;
  const cycled = (((marchIndex * spacing + spacing / 2 + phaseUnits) % span) + span) % span;
  return edge - (cycled - spacing / 2);
};

/**
 * A chevron glyph's half-extent along the flow at unit scale — the shared
 * truth both renderers' `platform_arrow` geometry must match (tip z −0.41,
 * wing back +0.41: 0.82 deep). The fold depth derives from it: at the wrap
 * the chevron stands vertical, so this half becomes its vertical reach and
 * a rescaled glyph still hides fully without retuning.
 */
export const CHEVRON_HALF_DEPTH = 0.41;

/**
 * Clearance below a folded chevron's lowest point at the wrap — past the
 * strip's own lift (0.015) plus the bevel drop of a KayKit top (~0.05),
 * with a hair of safety, so the wrap stays buried even where the deck edge
 * rounds off.
 */
export const FOLD_DEPTH_MARGIN = 0.08;

/**
 * How deep a chevron's centre sits at the wrap: its vertical half-reach
 * plus clearance — the wrap hides inside the deck (a 1-thick deck buries
 * the deepest fold, 0.49 at unit scale, with room to spare).
 */
export const foldDepth = (layout: StripLayout): number =>
  CHEVRON_HALF_DEPTH * layout.unit + FOLD_DEPTH_MARGIN;

/**
 * How far back from the wrap point a chevron's rendered position pulls at
 * full fold, toward the strip centre. The stretched grid lands the wrap
 * exactly on the deck's side face, where a vertical glyph would sit
 * coplanar with it and flicker — a tenth inside keeps it buried behind the
 * face from every angle. Small enough to never read as a rhythm stutter
 * (the march itself is untouched; only the rendered pose pulls back).
 */
export const FOLD_RETREAT = 0.1;

/**
 * Width of the fold envelope at each travel end, in flow units — a gentle
 * bend on roomy decks, narrowed on tiny ones so a lone chevron still rides
 * flat mid-travel instead of folding its whole cycle. Always narrower than
 * half the pitch, so the rest pose (chevrons half a pitch inside the wrap)
 * is structurally flat on every deck.
 */
export const diveWidth = (layout: StripLayout): number =>
  Math.min(0.5, layout.spacing * 0.3, layout.span * 0.2);

/**
 * 0 mid-travel → 1 at the wrap (±`span`/2), eased — the one envelope the
 * fold's sink, pitch and pullback all share, so a chevron mid-fold reads as
 * one bend: half still on top, half already folding down over the edge.
 */
const foldEndness = (layout: StripLayout, z: number): number => {
  const w = diveWidth(layout);
  const half = layout.span / 2;
  return Math.min(1, smooth01((w - (z + half)) / w) + smooth01((w - (half - z)) / w));
};

/**
 * A chevron's height at along-flow `z`: deck level mid-travel, easing down
 * to `−foldDepth` at both travel ends (±`span`/2). The wrap point sits at
 * full depth, so a chevron approaching it folds out of sight over the deck
 * edge instead of visibly jumping back to the start.
 */
export const diveY = (layout: StripLayout, z: number): number => {
  const endness = foldEndness(layout, z);
  // +0 mid-travel, never −0 — `−depth × 0` would read as "folding" to `Object.is`.
  return endness === 0 ? 0 : -foldDepth(layout) * endness;
};

/**
 * A chevron's pitch (`rotation.x` in the strip frame, flow along −Z) at
 * along-flow `z`: flat mid-travel, easing to a nose-down quarter turn at
 * the wrap — the fold over the deck edge. The same sign at both ends: the
 * flow is −Z everywhere, so a chevron surfacing at the entry unbends
 * exactly as the one wrapping at the exit bent, and the wrap itself is
 * pose-continuous (same depth, same pitch — only the buried z jumps).
 */
export const foldPitch = (layout: StripLayout, z: number): number => {
  const endness = foldEndness(layout, z);
  return endness === 0 ? 0 : (-Math.PI / 2) * endness;
};

/**
 * A chevron's rendered pullback along the flow at along-flow `z`: 0
 * mid-travel, easing to ∓`FOLD_RETREAT` (toward the centre) at the wrap.
 * Applied to the rendered z only; the march rhythm never sees it.
 */
export const foldRetreat = (layout: StripLayout, z: number): number => {
  const endness = foldEndness(layout, z);
  if (endness === 0 || z === 0) return 0;
  return -Math.sign(z) * FOLD_RETREAT * endness;
};

/**
 * One chevron's full rendered pose — the single seam both renderers pose
 * through, so the march, the sink, the pitch and the pullback can never
 * disagree about which z-space they are in.
 */
export interface ChevronPose {
  /** Rendered along-flow position: the march plus the fold's pullback. */
  z: number;
  /** Height: deck level mid-travel, folding down to `−foldDepth` at the wrap. */
  y: number;
  /** Pitch (`rotation.x`): flat mid-travel, a nose-down quarter turn at the wrap. */
  pitch: number;
}

/**
 * Chevron `marchIndex`'s rendered pose at `phaseUnits` units marched — the
 * march composed with the fold, in one call. Renderers set position from
 * `z`/`y` and `rotation.x` from `pitch`; tests assert rendered meshes
 * against this instead of re-deriving the composition.
 */
export const chevronPose = (
  layout: StripLayout,
  marchIndex: number,
  phaseUnits: number,
): ChevronPose => {
  const march = marchZ(layout, marchIndex, phaseUnits);
  return {
    z: march + foldRetreat(layout, march),
    y: diveY(layout, march),
    pitch: foldPitch(layout, march),
  };
};

/** Smoothstep clamped to [0, 1] — eases the fold in and out of the flat. */
const smooth01 = (t: number): number => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
};
