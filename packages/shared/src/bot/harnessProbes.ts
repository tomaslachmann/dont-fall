import { dotVec3, subVec3, vec3, type Vec3 } from "../math/vec3.js";
import { CharacterController } from "../simulation/CharacterController.js";
import type { MovingSegment } from "../simulation/MovingSegment.js";
import { RapierSimulation } from "../simulation/RapierSimulation.js";
import type { SimState } from "../state/SimState.js";
import { BOT_RIDE_TOP_TOLERANCE_M } from "../tuning/bots.js";
import { CAPSULE_BOTTOM_OFFSET } from "../tuning/character.js";
import { BUMP_IMPULSE_SCALE } from "../tuning/fight.js";
import { IMPACT_STAGGER_MIN } from "../tuning/knockdown.js";
import type { BotTrack } from "./Bot.js";
import { DeckRider } from "./deckRider.js";
import { EdgeGuard, voidEdgeDistance, voidEdgesNear } from "./edgeGuard.js";
import { LocalMotionPlanner } from "./localMotion.js";
import { navFloorWithin } from "./navMesh.js";
import { PathFollower } from "./PathBot.js";
import { SweeperHold } from "./sweeperHold.js";

/*
 * The section harness's instruments (M17 ticket 14's measuring tool, made a
 * committed part of the harness after its scratch copies were lost with a
 * cloud session). Two, each off unless a `SectionRun` asks for it:
 *
 * - `impactLog`: every Impact of Stagger strength a Bot takes while on its
 *   feet, from a Moving Segment (07m's log: the Segment, the closing speed,
 *   the body's and the Bot's own speed) or from another Character (phase 3's
 *   Bumps: who pushed whom), each with what the Bot's hooks were doing and how
 *   far it stood from a drop, joined to the Fall it led to, if any.
 * - `stepOffTrace`: for every Fall classified `step-off`, the Bot's last
 *   seconds Tick by Tick (position, velocity, motion state, rider state, the
 *   follower's, the hold's and the guard's outputs, the nearest Character),
 *   and the ground under it where it last stood.
 *
 * They read by wrapping prototype methods for the length of one run, as the
 * harness already does for `LinkReplay.step`: nothing is wrapped when neither
 * is asked for, and everything is put back in `finally`. The wrappers are
 * global, so only one instrumented run may be under way at a time.
 */

/** Ticks of history a step-off trace keeps before the last ground Tick. */
const STEP_OFF_TRACE_TICKS = 120;
/** How long after an Impact a Fall still counts as the Impact's. */
const IMPACT_FALL_TICKS = 150;
/** How near another Character must stand to be named in a trace row. */
const TRACE_NEAR_M = 1.5;
/** How far round a point void edges are gathered for its distance to a drop. */
const EDGE_REACH_M = 4;

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Where an Impact came from. */
export type ImpactSource =
  | { readonly kind: "segment"; readonly segmentIndex: number; readonly moduleId: string; readonly role: string; readonly motion: string }
  | { readonly kind: "character"; readonly id: string };

export interface ImpactRecord {
  readonly bot: string;
  readonly tick: number;
  readonly source: ImpactSource;
  /** Closing speed along the contact normal, the simulation's own rule. */
  readonly closing: number;
  readonly magnitude: number;
  /** The source's own speed at the contact: the body's point speed, or the other Character's speed. */
  readonly sourceSpeed: number;
  /** The Bot's own speed. */
  readonly botSpeed: number;
  readonly at: Vec3;
  readonly motionState: string;
  /** `DeckRider`'s state within the last two Ticks, else `off`. */
  readonly rider: string;
  /** What the Bot's `SweeperHold` returned last: `go`, `go-gaveup`, `committed`, `arc`, `arc-wait`, `plan:<candidate>`, with `stale(…)` if more than three Ticks before. */
  readonly hook: string;
  /** Distance across the ground to the nearest drop. */
  readonly edgeDistance: number;
  /** The Fall this Impact led to, if the Bot fell within {@link IMPACT_FALL_TICKS}. */
  fall?: { readonly tick: number; readonly cause: string };
}

export interface TraceRow {
  readonly tick: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly grounded: boolean;
  readonly motionState: string;
  readonly rider: string;
  readonly follow: string;
  readonly hold: string;
  readonly guard: string;
  readonly near: string;
}

export interface StepOffTrace {
  readonly bot: string;
  /** The last Tick it stood. */
  readonly tick: number;
  readonly fallTick: number;
  readonly rider: string;
  /** The ground where it last stood. */
  readonly ground: {
    readonly position: Vec3;
    readonly motionState: string;
    /** The navmesh floor under its feet, within 3 m down; null over a gap or a face the navmesh leaves out. */
    readonly navFloorY: number | null;
    /** The nearest navmesh floor within 1.5 m across and 3 m up or down: its height and how far across. Null with none. */
    readonly nearestFloor: { readonly y: number; readonly across: number } | null;
    readonly edgeDistance: number;
    /** The moving Platform it stood on, if any. */
    readonly platform: number | null;
  };
  readonly rows: readonly TraceRow[];
}

export interface ProbeOptions {
  readonly impactLog?: boolean;
  readonly stepOffTrace?: boolean;
}

let active: HarnessProbes | null = null;

const idOfSeed = (seed: string): string => seed.slice(seed.lastIndexOf(":") + 1);
const xz = (v: Vec3): string => `${v.x.toFixed(2)},${v.z.toFixed(2)}`;

/** One run's instruments: `install` before the first Tick, `tick` after each, `fell` on each Fall, `restore` in `finally`. */
export class HarnessProbes {
  readonly impacts: ImpactRecord[] = [];
  readonly stepOffs: StepOffTrace[] = [];
  /** Every Bump between Characters, of any strength. */
  bumps = 0;

  private readonly rider = new Map<string, { tick: number; state: string }>();
  private readonly hookOut = new Map<string, { tick: number; kind: string }>();
  private readonly follow = new Map<string, Map<number, string>>();
  private readonly hold = new Map<string, Map<number, string>>();
  private readonly guard = new Map<string, Map<number, string>>();
  private readonly rows = new Map<string, TraceRow[]>();
  private readonly restores: (() => void)[] = [];
  private simTick = 0;

  constructor(
    private readonly sim: RapierSimulation,
    private readonly track: BotTrack,
    private readonly options: ProbeOptions,
  ) {}

  /** Whether any instrument is on. */
  get on(): boolean {
    return this.options.impactLog === true || this.options.stepOffTrace === true;
  }

  install(): void {
    if (!this.on) return;
    if (active !== null) throw new Error("harnessProbes: one instrumented run at a time (the wrappers are global)");
    active = this;
    const probes = this;
    const wrap = <T extends object>(proto: T, name: string, make: (original: Any) => Any): void => {
      const target = proto as Any;
      const original = target[name];
      target[name] = make(original);
      this.restores.push(() => {
        target[name] = original;
      });
    };

    // What each Bot's hooks did, keyed by the Bot's id (the seed's last part, or the view's id).
    wrap(DeckRider.prototype, "steer", (original) =>
      function (this: Any, ctx: Any) {
        const before = this.state;
        const out = original.call(this, ctx);
        const id = idOfSeed(ctx.seed);
        probes.rider.set(id, { tick: ctx.tick, state: this.state });
        if (probes.options.stepOffTrace) probes.put(probes.follow, id, ctx.tick, `rider ${before}->${this.state}${out === null ? "" : ` ${xz(out.moveDirection)}${out.jump ? " J" : ""}`}`);
        return out;
      },
    );
    let arcTick = Number.NEGATIVE_INFINITY;
    let arcWait = false;
    let planTick = Number.NEGATIVE_INFINITY;
    let planName = "";
    wrap(SweeperHold.prototype, "followArc", (original) =>
      function (this: Any, ctx: Any) {
        arcTick = ctx.tick;
        arcWait = this.arc !== null && ctx.tick < this.arc.startTick;
        return original.call(this, ctx);
      },
    );
    wrap(LocalMotionPlanner.prototype, "steer", (original) =>
      function (this: Any, ctx: Any, choice: Any) {
        planTick = ctx.tick;
        planName = choice.candidate.name;
        return original.call(this, ctx, choice);
      },
    );
    wrap(SweeperHold.prototype, "hold", (original) =>
      function (this: Any, ctx: Any, steering: Any) {
        const out = original.call(this, ctx, steering);
        let kind: string;
        if (out === steering) kind = steering.committed === true ? "committed" : ctx.tick < this.goUntil ? "go-gaveup" : "go";
        else if (arcTick === ctx.tick) kind = arcWait ? "arc-wait" : "arc";
        else if (planTick === ctx.tick) kind = `plan:${planName}`;
        else kind = "other";
        const id = idOfSeed(ctx.seed);
        probes.hookOut.set(id, { tick: ctx.tick, kind });
        if (probes.options.stepOffTrace) probes.put(probes.hold, id, ctx.tick, out === steering ? "-" : `${kind} ${xz(out.moveDirection)}`);
        return out;
      },
    );
    if (this.options.stepOffTrace) {
      wrap(PathFollower.prototype, "follow", (original) =>
        function (this: Any, view: Any, ...rest: Any[]) {
          const out = original.call(this, view, ...rest);
          const prior = probes.follow.get(view.id)?.get(view.tick);
          probes.put(probes.follow, view.id, view.tick, `${prior === undefined ? "" : `${prior} | `}${xz(out.moveDirection)}${out.committed ? " C" : ""}${out.jump ? " J" : ""}${out.dash ? " D" : ""}`);
          return out;
        },
      );
      wrap(EdgeGuard.prototype, "guard", (original) =>
        function (this: Any, view: Any, move: Any, ...rest: Any[]) {
          const out = original.call(this, view, move, ...rest);
          probes.put(probes.guard, view.id, view.tick, out === move ? "=" : `asked ${xz(move)} sent ${xz(out)}`);
          return out;
        },
      );
    }

    if (this.options.impactLog) {
      // A Moving Segment's Impact: which Segment, found as the simulation finds it, with the greatest closing speed.
      let current: CharacterController | null = null;
      wrap(RapierSimulation.prototype, "resolveMovingSegmentContacts", (original) =>
        function (this: Any, character: CharacterController) {
          if (this !== probes.sim) return original.call(this, character);
          probes.simTick = this.tickCount;
          current = character;
          try {
            return original.call(this, character);
          } finally {
            current = null;
          }
        },
      );
      wrap(CharacterController.prototype, "applyImpact", (original) =>
        function (this: Any, impulse: Vec3, cause: string) {
          if (cause !== "Obstacle" || current !== this) return original.call(this, impulse, cause);
          const before: string = this.machine.state;
          const magnitude = Math.hypot(impulse.x, impulse.y, impulse.z);
          if (magnitude >= IMPACT_STAGGER_MIN && (before === "Controlled" || before === "Sliding")) probes.segmentImpact(this, magnitude, before);
          return original.call(this, impulse, cause);
        },
      );
      // A Character's Bump: the simulation's own closing speed and scale.
      wrap(RapierSimulation.prototype, "resolveBump", (original) =>
        function (this: Any, moverId: string, bumpedId: string, moverVelocity: Vec3, normal: Vec3) {
          if (this === probes.sim) probes.bump(moverId, bumpedId, moverVelocity, normal);
          return original.call(this, moverId, bumpedId, moverVelocity, normal);
        },
      );
    }
  }

  restore(): void {
    for (const undo of this.restores.splice(0).reverse()) undo();
    if (active === this) active = null;
  }

  /** After each Tick: keep each Bot's trace rows. */
  tick(next: SimState): void {
    if (!this.options.stepOffTrace) return;
    const ids = Object.keys(next.characters);
    for (const id of ids) {
      const c = next.characters[id]!;
      let near = "";
      let best = TRACE_NEAR_M;
      for (const other of ids) {
        if (other === id) continue;
        const o = next.characters[other]!;
        const d = Math.hypot(o.position.x - c.position.x, o.position.z - c.position.z);
        if (d < best) {
          best = d;
          near = `${other}@${d.toFixed(2)}`;
        }
      }
      // The row pairs the state at Tick t with the input that produced it (decided for Tick t).
      const k = next.tick;
      const list = this.rows.get(id) ?? [];
      list.push({
        tick: next.tick,
        position: c.position,
        velocity: c.velocity,
        grounded: c.grounded,
        motionState: c.motionState,
        rider: this.rider.get(id)?.tick === k ? this.rider.get(id)!.state : "-",
        follow: this.follow.get(id)?.get(k) ?? "-",
        hold: this.hold.get(id)?.get(k) ?? "-",
        guard: this.guard.get(id)?.get(k) ?? "-",
        near,
      });
      if (list.length > STEP_OFF_TRACE_TICKS + 16) list.shift();
      this.rows.set(id, list);
    }
    // The per-Tick output maps only need the trace's window.
    const oldest = next.tick - STEP_OFF_TRACE_TICKS - 16;
    for (const m of [this.follow, this.hold, this.guard]) for (const inner of m.values()) for (const t of inner.keys()) if (t < oldest) inner.delete(t);
  }

  /** A Fall the harness classified: join it to the Impacts before it, and trace a step-off. */
  fell(bot: string, cause: string, ground: { tick: number; position: Vec3 } | undefined, fallTick: number, motionState: string): void {
    if (this.options.impactLog) {
      for (const impact of this.impacts) {
        if (impact.bot !== bot || impact.fall !== undefined) continue;
        if (impact.tick <= fallTick && fallTick - impact.tick <= IMPACT_FALL_TICKS) impact.fall = { tick: fallTick, cause };
      }
    }
    if (!this.options.stepOffTrace || cause !== "step-off" || ground === undefined) return;
    const rows = (this.rows.get(bot) ?? []).filter((r) => r.tick >= ground.tick - STEP_OFF_TRACE_TICKS);
    const p = ground.position;
    const floor = navFloorWithin(this.track.nav, { x: p.x, y: p.y - CAPSULE_BOTTOM_OFFSET - 1.5, z: p.z }, { x: 0.3, y: 1.5, z: 0.3 });
    const feet = { x: p.x, y: p.y - CAPSULE_BOTTOM_OFFSET, z: p.z };
    const nearest = navFloorWithin(this.track.nav, feet, { x: 1.5, y: 3, z: 1.5 });
    const platform = this.track.moving.platformUnder(p, ground.tick, this.sim.motionClock, BOT_RIDE_TOP_TOLERANCE_M);
    const at = rows.find((r) => r.tick === ground.tick);
    this.stepOffs.push({
      bot,
      tick: ground.tick,
      fallTick,
      rider: at?.rider ?? this.riderAt(bot, ground.tick),
      ground: { position: p, motionState: at?.motionState ?? motionState, navFloorY: floor?.y ?? null, nearestFloor: nearest === null ? null : { y: nearest.y, across: Math.hypot(nearest.x - p.x, nearest.z - p.z) }, edgeDistance: this.edgeAt(p), platform: platform?.index ?? null },
      rows,
    });
  }

  private put(m: Map<string, Map<number, string>>, id: string, tick: number, text: string): void {
    let inner = m.get(id);
    if (inner === undefined) m.set(id, (inner = new Map()));
    inner.set(tick, text);
  }

  private riderAt(bot: string, tick: number): string {
    const r = this.rider.get(bot);
    return r !== undefined && r.tick >= tick - 2 ? r.state : "off";
  }

  private hookAt(bot: string, tick: number): string {
    const h = this.hookOut.get(bot);
    if (h === undefined) return "none";
    return tick + 1 - h.tick > 3 ? `stale(${h.kind})` : h.kind;
  }

  private edgeAt(p: Vec3): number {
    return voidEdgeDistance(voidEdgesNear(this.track.nav, p, p.y - CAPSULE_BOTTOM_OFFSET, EDGE_REACH_M), p.x, p.z);
  }

  private idOf(character: CharacterController): string {
    for (const [id, c] of (this.sim as Any).characters as Map<string, CharacterController>) if (c === character) return id;
    return "?";
  }

  private segmentImpact(character: Any, magnitude: number, motionState: string): void {
    const sim = this.sim as Any;
    const capsule = sim.world.getCollider(character.colliderHandle);
    let best: { segment: MovingSegment; closing: number; speed: number } | null = null;
    sim.world.intersectionsWithShape(capsule.translation(), capsule.rotation(), capsule.shape, (collider: Any) => {
      const segment: MovingSegment | undefined = sim.movingSegmentByHandle.get(collider.handle);
      if (segment === undefined) return true;
      const contact = collider.contactCollider(capsule, 0);
      if (!contact) return true;
      const normal = vec3(contact.normal1.x, contact.normal1.y, contact.normal1.z);
      const v: Vec3 = sim.movingSegmentVelocityAt(segment, vec3(contact.point1.x, contact.point1.y, contact.point1.z));
      const closing = Math.abs(dotVec3(subVec3(v, character.currentVelocity), normal));
      if (best === null || closing > best.closing) best = { segment, closing, speed: Math.hypot(v.x, v.z) };
      return true;
    });
    if (best === null) return;
    const found = best as { segment: MovingSegment; closing: number; speed: number };
    const t = capsule.translation();
    const at = vec3(t.x, t.y, t.z);
    const id = this.idOf(character);
    const config = found.segment.config;
    const body = this.track.moving.bodies.find((b) => b.config.segmentIndex === config.segmentIndex && b.config.part === config.part);
    this.impacts.push({
      bot: id,
      tick: this.simTick,
      source: { kind: "segment", segmentIndex: config.segmentIndex, moduleId: config.moduleId, role: body?.role ?? "?", motion: Object.keys(config.motion).join("+") },
      closing: found.closing,
      magnitude,
      sourceSpeed: found.speed,
      botSpeed: Math.hypot(character.currentVelocity.x, character.currentVelocity.z),
      at,
      motionState,
      rider: this.riderAt(id, this.simTick),
      hook: this.hookAt(id, this.simTick),
      edgeDistance: this.edgeAt(at),
    });
  }

  private bump(moverId: string, bumpedId: string, moverVelocity: Vec3, normal: Vec3): void {
    const sim = this.sim as Any;
    const bumped: Any = sim.characters.get(bumpedId);
    if (bumped === undefined) return;
    // `resolveBump`'s own arithmetic: `-normal` is from the mover toward the target.
    const tx = -normal.x;
    const tz = -normal.z;
    if (moverVelocity.x * tx + moverVelocity.z * tz <= 0) return;
    const closing = (moverVelocity.x - bumped.currentVelocity.x) * tx + (moverVelocity.z - bumped.currentVelocity.z) * tz;
    if (closing <= 0) return;
    this.bumps += 1;
    const magnitude = closing * BUMP_IMPULSE_SCALE;
    const before: string = bumped.machine.state;
    if (magnitude < IMPACT_STAGGER_MIN || (before !== "Controlled" && before !== "Sliding")) return;
    const p = bumped.position as Vec3;
    const tick = sim.tickCount;
    this.impacts.push({
      bot: bumpedId,
      tick,
      source: { kind: "character", id: moverId },
      closing,
      magnitude,
      sourceSpeed: Math.hypot(moverVelocity.x, moverVelocity.z),
      botSpeed: Math.hypot(bumped.currentVelocity.x, bumped.currentVelocity.z),
      at: vec3(p.x, p.y, p.z),
      motionState: before,
      rider: this.riderAt(bumpedId, tick),
      hook: this.hookAt(bumpedId, tick),
      edgeDistance: this.edgeAt(p),
    });
  }
}

/** The impact log as text: counts by source and by hook output, then one line per Impact. */
export const formatImpactLog = (impacts: readonly ImpactRecord[], bumps: number): string => {
  const out: string[] = [];
  const bySource = new Map<string, { n: number; fell: number; rider: Record<string, number>; hook: Record<string, number>; botStill: number }>();
  for (const i of impacts) {
    const key = i.source.kind === "segment" ? `seg ${i.source.segmentIndex} ${i.source.moduleId} ${i.source.role}/${i.source.motion}` : "Characters";
    const s = bySource.get(key) ?? { n: 0, fell: 0, rider: {}, hook: {}, botStill: 0 };
    s.n += 1;
    if (i.fall !== undefined) s.fell += 1;
    s.rider[i.rider] = (s.rider[i.rider] ?? 0) + 1;
    s.hook[i.hook] = (s.hook[i.hook] ?? 0) + 1;
    if (i.botSpeed < 0.5) s.botStill += 1;
    bySource.set(key, s);
  }
  out.push(`impacts ${impacts.length} (Bumps of any strength: ${bumps})`);
  for (const [key, s] of [...bySource.entries()].sort((a, b) => b[1].n - a[1].n)) {
    out.push(`  ${key}: ${s.n}, ${s.fell} led to a Fall, Bot standing (< 0.5 u/s) ${s.botStill}, rider ${JSON.stringify(s.rider)}, hook ${JSON.stringify(s.hook)}`);
  }
  for (const i of impacts) {
    const src = i.source.kind === "segment" ? `seg ${i.source.segmentIndex}` : `by ${i.source.id}`;
    out.push(
      `  ${i.bot} t${i.tick} ${src} closing ${i.closing.toFixed(1)} source ${i.sourceSpeed.toFixed(1)} bot ${i.botSpeed.toFixed(1)} ${i.motionState} rider=${i.rider} hook=${i.hook} edge ${i.edgeDistance.toFixed(2)}${i.fall === undefined ? "" : ` -> ${i.fall.cause} Fall t${i.fall.tick}`}`,
    );
  }
  return out.join("\n");
};

/** The step-off traces as text: the ground, then the rows, newest last. */
export const formatStepOffTraces = (traces: readonly StepOffTrace[]): string => {
  const out: string[] = [];
  for (const t of traces) {
    const g = t.ground;
    out.push(
      `-- ${t.bot} step-off: last stood t${t.tick}, fell t${t.fallTick}, rider ${t.rider}; ground (${g.position.x.toFixed(2)}, ${g.position.y.toFixed(2)}, ${g.position.z.toFixed(2)}) ${g.motionState}, nav floor ${g.navFloorY === null ? "none" : g.navFloorY.toFixed(2)}, nearest floor ${g.nearestFloor === null ? "none" : `y ${g.nearestFloor.y.toFixed(2)} ${g.nearestFloor.across.toFixed(2)} m across`}, feet y ${(g.position.y - CAPSULE_BOTTOM_OFFSET).toFixed(2)}, edge ${g.edgeDistance.toFixed(2)} m, platform ${g.platform ?? "-"}`,
    );
    for (const r of t.rows) {
      out.push(
        `  t${r.tick} pos ${r.position.x.toFixed(2)},${r.position.y.toFixed(2)},${r.position.z.toFixed(2)} v ${r.velocity.x.toFixed(1)},${r.velocity.z.toFixed(1)} ${r.grounded ? "G" : "air"} ${r.motionState} near[${r.near}] | rider ${r.rider} | follow ${r.follow} | hold ${r.hold} | guard ${r.guard}`,
      );
    }
  }
  return out.join("\n");
};
