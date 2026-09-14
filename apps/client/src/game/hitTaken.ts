import type { RagdollCause } from "@dont-fall/shared";

/**
 * You just got Hit, mid-Round (M9 ticket 09, Hit-received) — the HitFeedback
 * flash's facts. Raised off the authoritative snapshot, never the local
 * prediction: only the server (or a full multi-Character sim) can resolve a
 * cross-Character landing, which is exactly what `hitReactEpoch` carries.
 */
export interface HitTakenEvent {
  /**
   * This down episode was caused by a Hit — a fresh `ragdollEpoch` with
   * cause `"Hit"`. The overlay reads KNOCKED DOWN instead of the plain YOU
   * GOT HIT. A stagger-tier (or weaker) landing reads the plain variant.
   */
  knockedDown: boolean;
}

/**
 * The last-seen Epoch baseline the edges below compare against — shared
 * with the loop, which holds one per Match and re-syncs it every RUNNING
 * snapshot (cold start seeds, never fires).
 */
export interface HitBaseline {
  hitReactEpoch: number;
  ragdollEpoch: number;
}

interface HitTakenCharacter {
  hitReactEpoch: number;
  ragdollEpoch: number;
  ragdollCause: RagdollCause;
}

/**
 * The edge from "not just hit" to "just hit" — pure, so the tests pin it
 * without a socket or a loop (the `detectRunEnd` shape). Two independent
 * edges, not one (code review): a Hit's own landing and the knockdown it
 * causes resolve on *consecutive* ticks — `registerHitReceived` bumps
 * immediately inside `resolveHit`, while the Ragdoll entry lands on the
 * next `beginTick` via the state machine's deferred impact queue — so the
 * two epochs never rise on the same tick and must never be read as one
 * same-tick conjunction. Both edges in one snapshot gap still flash once,
 * with the more urgent news (the down) subsuming the tag.
 *
 * Greater-than, not identity: both epochs are monotonic counters that only
 * ever increment, so a rise is strictly greater — and a reordered or
 * replayed snapshot carrying an older-or-equal epoch can never re-fire
 * (the SimState `ragdollEpoch > lastAppliedEpoch` idiom).
 */
export const detectHitTaken = (args: {
  /** Last-seen baseline, or `null` before the first sighting (cold start seeds, never fires). */
  previous: HitBaseline | null;
  /** Your Character this snapshot — absent when there's no run to flash for. */
  character: HitTakenCharacter | undefined;
}): HitTakenEvent | null => {
  const me = args.character;
  if (me === undefined || args.previous === null) return null;
  const hitEdge = me.hitReactEpoch > args.previous.hitReactEpoch;
  const downEdge = me.ragdollEpoch > args.previous.ragdollEpoch && me.ragdollCause === "Hit";
  if (!hitEdge && !downEdge) return null;
  return { knockedDown: downEdge };
};
