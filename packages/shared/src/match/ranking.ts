/**
 * Standard competition ranking over an already-ordered list (code review, M7
 * ticket 03/04): a tie shares a placement and the next one skips (1, 1, 3 —
 * never 1, 1, 2). `buildResults` (Qualified tier) and `buildRoundResult`
 * (the whole ranked field, spanning tiers) both need exactly this
 * arithmetic and used to hand-roll their own copy of it — one place now
 * owns "how placements advance," while each caller still supplies its own
 * answer to "are these two actually tied," since that differs by what's
 * being ranked (a shared `finishTick`, an `eliminatedTick`, ...).
 *
 * `qualificationPlacement` (`Qualification.ts`) is deliberately not built on
 * this: it answers a different question — one Character's placement,
 * counted directly from an *unordered* collection, without ever
 * materializing a sorted list at all. Forcing it through this shape would
 * cost the very allocation it exists to avoid, for no shared code.
 */
export const rankWithTies = <T>(items: readonly T[], isTiedWithPrevious: (prev: T, curr: T) => boolean): number[] => {
  const placements: number[] = [];
  let placement = 0;
  items.forEach((item, i) => {
    if (i === 0 || !isTiedWithPrevious(items[i - 1]!, item)) placement = i + 1;
    placements.push(placement);
  });
  return placements;
};
