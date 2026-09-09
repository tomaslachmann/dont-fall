import type { MatchPhase } from "@dont-fall/shared";

/**
 * Whether Spectator Mode is on (M7 ticket 07, CONTEXT.md "Spectator Mode"):
 * this client's Character is eliminated and the Round that eliminated it is
 * still running. RUNNING-only — it ends with the Round ("lasts until the
 * Round ends"), never later, and the next Round starts you playing (ADR
 * 0049) once reconcile clears the flag on the rebuilt world.
 */
export const isSpectating = (phase: MatchPhase, ownEliminated: boolean): boolean =>
  phase === "RUNNING" && ownEliminated;

/**
 * Who this client may follow: everyone still in the Round but itself, in a
 * stable order so the cycle key walks the same list on every frame. Read off
 * the authoritative snapshot's own `eliminated` flags (ADR 0042) — the
 * interpolated render pose carries no liveness, only position.
 */
export const livingIds = (characters: Record<string, { eliminated: boolean }>, myId: string): string[] =>
  Object.entries(characters)
    .filter(([id, character]) => id !== myId && !character.eliminated)
    .map(([id]) => id)
    .sort();

/**
 * The next target after `current` in `living`, wrapping around — or the
 * first one when `current` is nobody (not following yet, or the followed
 * Character just got eliminated). `null` when nobody is living: the caller
 * falls back to its own position, so the camera never holds a dead target.
 */
export const nextSpectatorTarget = (living: readonly string[], current: string | null): string | null => {
  if (living.length === 0) return null;
  if (current === null) return living[0]!;
  const index = living.indexOf(current);
  if (index === -1) return living[0]!;
  return living[(index + 1) % living.length]!;
};

/**
 * Which remote Character this eliminated client follows (M7 ticket 07). The
 * choice is the client's own — it never goes to the server or onto the
 * snapshot — so this is plain frame-loop state, not replicated state.
 */
export class SpectatorController {
  private targetId: string | null = null;

  get target(): string | null {
    return this.targetId;
  }

  /**
   * Reconcile the held target with who is still living, every frame. A
   * still-living target is kept — someone else dying must not yank the
   * camera — while a dead or missing one moves to the first living
   * Character, or to no target when none are left.
   */
  update(living: readonly string[]): void {
    if (this.targetId === null || !living.includes(this.targetId)) {
      this.targetId = living.length > 0 ? living[0]! : null;
    }
  }

  /** One press of the cycle key: step to the next living Character, wrapping. */
  cycle(living: readonly string[]): void {
    this.targetId = nextSpectatorTarget(living, this.targetId);
  }

  /** Leaving Spectator Mode hands the camera back with no leftover target. */
  reset(): void {
    this.targetId = null;
  }
}
