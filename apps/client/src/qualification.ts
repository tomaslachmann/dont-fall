/**
 * Where `id` placed among everyone who has Qualified, 1-based, or `null` if
 * that Character has not Qualified (M4 ticket 02).
 *
 * A pure projection of the Characters in one snapshot — Qualification itself
 * is `finishTick`, derived by the shared simulation from position alone (ADR
 * 0039), so placement needs nothing on the wire of its own. Read it from the
 * authoritative server snapshot rather than the local prediction: this
 * client only predicts its *own* Character, so its local sim has no idea when
 * anyone else crossed the line.
 *
 * Standard competition ranking — two Characters that entered on the same Tick
 * share a placement and the next one down skips. A Finish Zone is an area,
 * not a line (CONTEXT.md), precisely so that arriving together is possible;
 * inventing a tie-break here would be inventing a rule the simulation
 * doesn't have.
 */
export const qualificationPlacement = (
  characters: Record<string, { finishTick: number | null }>,
  id: string,
): number | null => {
  const mine = characters[id]?.finishTick;
  if (mine === undefined || mine === null) return null;
  let ahead = 0;
  for (const character of Object.values(characters)) {
    if (character.finishTick !== null && character.finishTick < mine) ahead += 1;
  }
  return ahead + 1;
};
