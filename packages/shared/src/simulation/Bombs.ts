import type { Vec3 } from "../math/vec3.js";
import { bombTicks, type BombDef, type BombState } from "../track/Bomb.js";
import type { Prop } from "./Prop.js";

/** One bomb going off this Tick (ADR 0126): where, and whom its knockdowns are credited to. */
export interface Blast {
  /** Which Prop went off. */
  propIndex: number;
  /** The bomb's middle as it went off — the blast's. */
  at: Vec3;
  /** The last one to hold it, or `null` if nobody ever had — a Shooter's bomb nobody caught (ADR 0127). */
  byId: string | null;
}

interface Bomb {
  def: BombDef;
  prop: Prop;
  /** A Shooter's (ADR 0127): lit by being fired, and waiting for its Shooter once spent rather than going home. */
  shot: boolean;
  /** Lit: the Tick it goes off on. */
  detonateTick: number | null;
  /** Spent: the Tick it went off (or out) on. */
  blastTick: number | null;
  /** Spent: the Tick it is back where it was placed — never, for a Shooter's. */
  returnTick: number | null;
  /** Spent by a blast, not by falling off — what a renderer draws an explosion for. */
  blasted: boolean;
  /** Who picked it up last — the one a blast is credited to (ADR 0126). */
  lastHolder: string | null;
}

/**
 * Every Bomb in a world and what has happened to it (CONTEXT.md: Bomb, ADR
 * 0126): lying, lit, or spent. The Prop is the body; this owns the clock.
 *
 * Only the authority lights one (a pick-up is the authority's alone, ADR
 * 0125) and only the authority sets one off. A client decides nothing: a
 * spent bomb's colliders follow the snapshot's `live`, and its renderer reads
 * the snapshot's rows.
 */
export class Bombs {
  private readonly bombs = new Map<number, Bomb>();

  constructor(props: readonly Prop[]) {
    props.forEach((prop, index) => {
      const def = prop.config.bomb;
      if (!def) return;
      this.bombs.set(index, {
        def,
        prop,
        shot: prop.config.projectile === true,
        detonateTick: null,
        blastTick: null,
        returnTick: null,
        blasted: false,
        lastHolder: null,
      });
    });
  }

  get any(): boolean {
    return this.bombs.size > 0;
  }

  /**
   * `holderId` picked up the Prop at `index` on `tick`. A bomb lying there is
   * lit by it; a lit one keeps burning. Either way `holderId` is now the one
   * its blast is credited to.
   */
  lifted(index: number, holderId: string, tick: number): void {
    const bomb = this.bombs.get(index);
    if (!bomb || bomb.blastTick !== null) return;
    bomb.lastHolder = holderId;
    bomb.detonateTick ??= tick + bombTicks(bomb.def.fuseSeconds);
  }

  /** The Shooter's bomb at `index` left the barrel on `tick` (ADR 0127): lit, and nobody's yet. */
  fired(index: number, tick: number): void {
    const bomb = this.bombs.get(index);
    if (!bomb) return;
    bomb.detonateTick = tick + bombTicks(bomb.def.fuseSeconds);
    bomb.blastTick = null;
    bomb.returnTick = null;
    bomb.blasted = false;
    bomb.lastHolder = null;
  }

  /**
   * One Tick of every bomb, after the step: bring back whatever is due, put
   * out whatever fell below `killPlaneY`, and set off whatever burned down —
   * returned, for the simulation to deal out. A spent bomb is parked where it
   * ended, colliders off; a carried one must have been let go of by now.
   */
  step(tick: number, killPlaneY: number, letGo: (index: number) => void): Blast[] {
    const blasts: Blast[] = [];
    for (const [index, bomb] of this.bombs) {
      if (bomb.blastTick !== null) {
        if (bomb.returnTick === null || tick < bomb.returnTick) continue;
        bomb.prop.home();
        bomb.blastTick = null;
        bomb.returnTick = null;
        bomb.blasted = false;
        bomb.lastHolder = null;
        continue;
      }
      // A Shooter's bomb waiting in its cannon is out of play, and nothing to put out.
      if (!bomb.prop.inFlight) continue;
      const at = bomb.prop.centre;
      if (bomb.detonateTick !== null && tick >= bomb.detonateTick) {
        letGo(index);
        blasts.push({ propIndex: index, at, byId: bomb.lastHolder });
        this.spend(bomb, tick, true);
      } else if (at.y < killPlaneY) {
        // Gone under the clouds: out, without a blast nobody would see.
        letGo(index);
        this.spend(bomb, tick, false);
      }
    }
    return blasts;
  }

  private spend(bomb: Bomb, tick: number, blasted: boolean): void {
    bomb.prop.park(bomb.prop.position);
    bomb.detonateTick = null;
    bomb.blastTick = tick;
    // A Shooter's bomb goes nowhere: it waits, parked, until it is fired again (ADR 0127).
    bomb.returnTick = bomb.shot ? null : tick + bombTicks(bomb.def.returnSeconds);
    bomb.blasted = blasted;
  }

  /** Every bomb that is not lying, for the Snapshot — an untouched Track sends nothing. */
  snapshot(): BombState[] {
    const rows: BombState[] = [];
    for (const [propIndex, bomb] of this.bombs) {
      if (bomb.detonateTick !== null) rows.push({ propIndex, detonateTick: bomb.detonateTick });
      else if (bomb.blastTick !== null) {
        rows.push({
          propIndex,
          blastTick: bomb.blastTick,
          ...(bomb.returnTick === null ? {} : { returnTick: bomb.returnTick }),
          ...(bomb.blasted ? { blasted: true } : {}),
        });
      }
    }
    return rows;
  }
}
