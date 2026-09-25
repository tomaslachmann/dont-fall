import { fragileLook, fragileReturnTick, fragileStanding, type FragileDef, type FragileLook, type FragileState } from "../track/Fragile.js";
import type { MovingSegment } from "./MovingSegment.js";

/**
 * Every fragile floor in a world and what has happened to it (CONTEXT.md:
 * Fragile, ADR 0118) — the first per-Segment state a Round changes.
 *
 * A floor is a body that can be switched off, so this owns nothing but the
 * counting: which Character arrived on what, when a floor is gone, and when
 * it comes back. The Snapshot carries only the floors that are not intact,
 * so an untouched Track costs nothing.
 */
export class FragileFloors {
  private readonly floors = new Map<number, { def: FragileDef; body: MovingSegment; hits: number; returnTick: number | null; changedAtTick: number }>();
  /** Which fragile floor each Character was standing on last tick — what makes an *arrival* an arrival. */
  private readonly standingOn = new Map<string, number>();

  constructor(bodies: readonly MovingSegment[]) {
    for (const body of bodies) {
      const def = body.config.fragile;
      if (def) this.floors.set(body.config.segmentIndex, { def, body, hits: 0, returnTick: null, changedAtTick: -1 });
    }
  }

  get any(): boolean {
    return this.floors.size > 0;
  }

  /** The fragile floor `segmentIndex` names, for a caller holding a ground collider's owner. */
  has(segmentIndex: number): boolean {
    return this.floors.has(segmentIndex);
  }

  /**
   * What `characterId` is standing on this tick, or `undefined` for anything
   * that is not a fragile floor. Becoming grounded on one it was not on last
   * tick costs that floor a state (ADR 0118): a landing and a walk-on count
   * alike, and standing still is not an arrival at all.
   */
  onGround(characterId: string, segmentIndex: number | undefined, tick: number): void {
    if (segmentIndex === undefined) {
      this.standingOn.delete(characterId);
      return;
    }
    const was = this.standingOn.get(characterId);
    this.standingOn.set(characterId, segmentIndex);
    if (was === segmentIndex) return;
    const floor = this.floors.get(segmentIndex);
    if (!floor || !fragileStanding(floor.def, floor.hits)) return;
    floor.hits += 1;
    floor.changedAtTick = tick;
    if (!fragileStanding(floor.def, floor.hits)) floor.returnTick = fragileReturnTick(floor.def, undefined, tick);
  }

  /** A Character that left the world stands on nothing. */
  forget(characterId: string): void {
    this.standingOn.delete(characterId);
  }

  /** Bring back whatever is due, then put every floor's colliders where its state says. */
  step(tick: number): void {
    for (const floor of this.floors.values()) {
      if (floor.returnTick !== null && tick >= floor.returnTick) {
        floor.hits = 0;
        floor.returnTick = null;
        floor.changedAtTick = tick;
      }
      floor.body.setSolid(fragileStanding(floor.def, floor.hits));
    }
  }

  /** Which look each floor wears right now, for the renderer — `null` where the floor is gone. */
  looks(): FragileLook[] {
    const rows: FragileLook[] = [];
    for (const [segmentIndex, floor] of this.floors) {
      rows.push({ segmentIndex, look: fragileStanding(floor.def, floor.hits) ? fragileLook(floor.def, floor.hits) : null });
    }
    return rows;
  }

  /** Every floor that is not intact, for the Snapshot — an untouched Track sends nothing. */
  snapshot(): FragileState[] {
    const rows: FragileState[] = [];
    for (const [segmentIndex, floor] of this.floors) {
      if (floor.hits === 0) continue;
      rows.push({ segmentIndex, hits: floor.hits, returnTick: floor.returnTick });
    }
    return rows;
  }

  /**
   * Take the server's word (ADR 0118) — except where this world has changed a
   * floor *since* the snapshot was taken. That exception is what lets a
   * client predict its own arrivals: a floor it just broke stays broken until
   * a snapshot from that Tick or later either confirms it or says otherwise,
   * instead of flickering back for a round trip.
   */
  applySnapshot(rows: readonly FragileState[] | undefined, serverTick: number): void {
    const byIndex = new Map((rows ?? []).map((row) => [row.segmentIndex, row]));
    for (const [segmentIndex, floor] of this.floors) {
      if (floor.changedAtTick > serverTick) continue;
      const row = byIndex.get(segmentIndex);
      floor.hits = row?.hits ?? 0;
      floor.returnTick = row?.returnTick ?? null;
      floor.body.setSolid(fragileStanding(floor.def, floor.hits));
    }
  }
}
