/**
 * A counter that only rises within one simulation, read once a frame off the
 * drawn Character (M14 ticket 05, ADR 0087): an Epoch (`launchPadEpoch`,
 * `hitEpoch`, …) or `respawnCount`.
 *
 * It fires when the value passes the highest one applied for that id, ADR
 * 0023's "last applied" idiom, so a reconciliation replay that re-produces a
 * value already heard stays silent. Two more rules:
 * - the first sight of an id is history, not an event (a Character joining
 *   mid-Match, or a Stage built mid-Round);
 * - a value below the applied one means a fresh simulation (the next Round
 *   starts every counter at 0). It is adopted without a sound.
 *
 * `refractoryMs` is for counters a replay can raise twice. `launchPadEpoch`
 * and `respawnCount` are not in `ReconcileBase`, so a replay across the tick
 * that raised them raises them again. A second rise inside the window is
 * adopted without firing.
 */
export class RiseLatch {
  private readonly applied = new Map<string, { value: number; firedAtMs: number }>();

  constructor(private readonly refractoryMs = 0) {}

  /** Whether `id`'s counter rose to a new value this frame. */
  rose(id: string, value: number, nowMs: number): boolean {
    const last = this.applied.get(id);
    if (!last || value < last.value) {
      this.applied.set(id, { value, firedAtMs: -Infinity });
      return false;
    }
    if (value === last.value) return false;
    const fires = nowMs - last.firedAtMs >= this.refractoryMs;
    this.applied.set(id, { value, firedAtMs: fires ? nowMs : last.firedAtMs });
    return fires;
  }

  forget(id: string): void {
    this.applied.delete(id);
  }
}
