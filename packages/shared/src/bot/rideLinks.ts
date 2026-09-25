import { addVec3, type Vec3 } from "../math/vec3.js";
import {
  BOT_LEG_JOINED_M,
  BOT_LINK_MIN_SAVING_M,
  BOT_LINK_RUNUP_M,
  BOT_RIDE_ENDS_MAX,
  BOT_RIDE_JUMP_FLIGHT_TICKS,
  BOT_RIDE_JUMP_REACH_M,
  BOT_RIDE_PHASE_STEP_TICKS,
  BOT_RIDE_PROBE_CELL_M,
  BOT_RIDE_RIM_INSET_M,
  BOT_RIDE_RIM_STEP_M,
  BOT_RIDE_TOP_TOLERANCE_M,
  BOT_RIDE_WALK_GAP_M,
  BOT_TRANSFER_SCAN_TICKS,
} from "../tuning/bots.js";
import { WALK_SPEED } from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import type { BotTrack } from "./Bot.js";
import type { Platform } from "./movingWorld.js";
import { navFloorWithin, navPath } from "./navMesh.js";

/*
 * The ride table (M17 ticket 07b): where each moving floor's rim meets still
 * floor, and which of those meetings a Bot boards at and alights at. Built
 * once per `BotTrack` on the loop (it needs the moving bodies), kept in a
 * `WeakMap`. A transfer end (M17 ticket 07e) meets another platform's rim
 * rather than still floor: its `to` names that platform, and its `still` is
 * only where its own rim point rests.
 */

type XZ = { x: number; z: number };

export interface RideEnd {
  /** Into `moving.platforms`. */
  readonly platform: number;
  /** A rim point in the platform frame, inset {@link BOT_RIDE_RIM_INSET_M} from the deck's outline. */
  readonly local: Vec3;
  /** The rim's outward normal at {@link local}, in the platform frame (y 0). */
  readonly outward: Vec3;
  /**
   * The navmesh floor point this end meets, a still point. A transfer end
   * (`to` set) meets no still floor: this is then the world point its own rim
   * point rests at, for the path's corners only; nothing walks to it.
   */
  readonly still: Vec3;
  /** false: the rim comes within {@link BOT_RIDE_WALK_GAP_M} of `still`; true: within jump reach, `still` a run-up back from its border. A transfer is always a jump. */
  readonly jump: boolean;
  /** M17 ticket 07e: the other platform this end's rim meets within jump reach at some Tick, and the rim point there; null for a still end. */
  readonly to: { readonly platform: number; readonly local: Vec3 } | null;
  /** How many (phase, rim point) samples met `still`: how often the end is open. */
  readonly hits: number;
  /**
   * The phases (Ticks into the platform's own period, sorted, unique) at
   * which a sample met `still` (M17 ticket 07d): when the end is open. A ride
   * costs the wait from arriving at its exit to the exit's next opening.
   */
  readonly openPhases: readonly number[];
}

export interface RideLink {
  readonly entry: RideEnd;
  readonly exit: RideEnd;
  /** Metres of hull between the two rim points. */
  readonly across: number;
  /**
   * The wait at the exit, in metres of walk (M17 ticket 07d): the mean over
   * the entry's open phases of the Ticks from arriving at the exit (boarding,
   * then `across` at walking pace) to the exit's next open phase, **less the
   * least any ride from the same entry waits** — which exit to ride to is the
   * question; which entry to board at stays the walk's (every entry of a spin
   * is the same rim passing at another phase, and priced absolutely the
   * planner sent twelve Bots to one corner of the lane, measured: 16 contact
   * Falls there). On a spinning square, the corner that met the lane meets
   * the other square half a turn later, so a ride to the corner it landed on
   * has `across` 0 and half a period's wait; the corner a quarter turn on
   * costs a few metres and a quarter.
   */
  readonly wait: number;
}

/** A platform's deck as the ride reads it: its outline (counter-clockwise, platform frame), its top and its centroid. */
export interface RideDeck {
  readonly hull: readonly XZ[];
  readonly y: number;
  readonly centroid: XZ;
}

export interface RideTable {
  readonly ends: readonly RideEnd[];
  readonly links: readonly RideLink[];
  /** Per platform index, its deck outline. */
  readonly decks: readonly RideDeck[];
  /** Wall-clock milliseconds the build took (the loop's budget: 50 ms on the base race). */
  readonly buildMs: number;
  /** Of {@link buildMs}, the transfer ends' scan (M17 ticket 07e; its budget: 80 ms on Spin Cycle). */
  readonly transferMs: number;
  /** Which still floor each end's `still` is on: ends sharing a number are joined by the navmesh. A transfer end's is {@link TRANSFER_COMPONENT}. */
  readonly component: readonly number[];
  /** Per end, the index of the transfer end it meets on the other platform (its `to`), or −1 for a still end. */
  readonly mirror: readonly number[];
  /** Navmesh walk lengths between points, cached for the Track's life (`null`: no walk). */
  walk(a: Vec3, b: Vec3): number | null;
  /** The component of any still point; one no walk joins to a known component starts a new one. */
  componentOf(p: Vec3): number;
}

/** A platform's deck as `movingWorld` reads it (its own geometry's outline, simplified), with its centroid; near-duplicate vertices dropped so every edge has a length. */
const deckOf = (platform: Platform): RideDeck => {
  const hull = platform.deck.hull.filter((p, i, all) => {
    const q = all[(i + 1) % all.length]!;
    return Math.hypot(q.x - p.x, q.z - p.z) > 0.05;
  });
  let cx = 0;
  let cz = 0;
  for (const p of hull) {
    cx += p.x / hull.length;
    cz += p.z / hull.length;
  }
  return { hull, y: platform.deck.y, centroid: { x: cx, z: cz } };
};

/** The rim points of a deck outline: its vertices and every {@link BOT_RIDE_RIM_STEP_M} along its edges, inset, with their outward normals. */
const rimOf = (deck: RideDeck): { local: Vec3; outward: Vec3 }[] => {
  const { hull, y } = deck;
  const n = hull.length;
  const normals: XZ[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = hull[i]!;
    const b = hull[(i + 1) % n]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    normals.push({ x: (b.z - a.z) / length, z: -(b.x - a.x) / length });
  }
  const out: { local: Vec3; outward: Vec3 }[] = [];
  const push = (p: XZ, o: XZ): void => {
    const length = Math.hypot(o.x, o.z) || 1;
    const u = { x: o.x / length, z: o.z / length };
    out.push({ local: { x: p.x - u.x * BOT_RIDE_RIM_INSET_M, y, z: p.z - u.z * BOT_RIDE_RIM_INSET_M }, outward: { x: u.x, y: 0, z: u.z } });
  };
  for (let i = 0; i < n; i += 1) {
    const a = hull[i]!;
    const b = hull[(i + 1) % n]!;
    const before = normals[(i + n - 1) % n]!;
    const own = normals[i]!;
    push(a, { x: before.x + own.x, z: before.z + own.z });
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(0, Math.ceil(length / BOT_RIDE_RIM_STEP_M) - 1);
    for (let k = 1; k <= steps; k += 1) {
      const t = k / (steps + 1);
      push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, own);
    }
  }
  return out;
};

const pathLength = (path: readonly Vec3[]): number => {
  let length = 0;
  for (let i = 1; i < path.length; i += 1) length += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z);
  return length;
};

/** The step a run-up is marched in, in metres, on a deck and on still floor. */
export const RUNUP_STEP_M = 0.25;

/**
 * A jump end's `still` as the spec has it: the run-up's start,
 * {@link BOT_LINK_RUNUP_M} back from the floor's border facing the rim,
 * along the floor. The probe answers the border itself, or a point deep in
 * the floor, and a run-up begun at the border left the floor before jump
 * was pressed (measured on the base race's second leg: eleven step-offs at
 * the still rows' far edges). From `found`, the border is the last point
 * with floor toward the rim; the still is as far back from it as the floor
 * goes, up to the run-up.
 */
const runUpBack = (probe: Probe, found: Vec3, o: XZ): Vec3 => {
  const box = { x: RUNUP_STEP_M, y: BOT_RIDE_TOP_TOLERANCE_M, z: RUNUP_STEP_M };
  let border = found;
  for (let k = 1; k * RUNUP_STEP_M <= BOT_RIDE_JUMP_REACH_M; k += 1) {
    const t = k * RUNUP_STEP_M;
    const p = probe({ x: found.x - o.x * t, y: found.y, z: found.z - o.z * t }, box);
    if (p === null) break;
    border = p;
  }
  let still = border;
  for (let k = 1; k * RUNUP_STEP_M <= BOT_LINK_RUNUP_M + 1e-6; k += 1) {
    const t = k * RUNUP_STEP_M;
    const p = probe({ x: border.x + o.x * t, y: border.y, z: border.z + o.z * t }, box);
    if (p === null) break;
    still = p;
  }
  // Shoulder room: a landing aimed at a still on the floor's side edge comes down on the bevel when the carry model is a
  // little off (measured: aimed at x −2.7 on a row whose navmesh ends at −2.6, landed at −3.2 and ran along the bevel off
  // its end). Where one side has floor within the rim inset and the other has not, the still moves in by that much; a floor
  // narrow on both sides (the balance beam) keeps its middle.
  const side = { x: -o.z, z: o.x };
  for (let pass = 0; pass < 2; pass += 1) {
    const left = probe({ x: still.x + side.x * BOT_RIDE_RIM_INSET_M, y: still.y, z: still.z + side.z * BOT_RIDE_RIM_INSET_M }, box);
    const right = probe({ x: still.x - side.x * BOT_RIDE_RIM_INSET_M, y: still.y, z: still.z - side.z * BOT_RIDE_RIM_INSET_M }, box);
    if ((left === null) === (right === null)) break;
    still = left ?? right!;
  }
  return still;
};

type Probe = (p: Vec3, box: Vec3) => Vec3 | null;

/**
 * `navFloorWithin` cached by probe cell (M17 ticket 07d): the still-end scan
 * probes the same world cells at phase after phase (a rim point at 114 phases,
 * every run-up marched a quarter metre at a time from the same border), and
 * the base race's eight platforms cost 136 k probes a build. The first probe
 * in a cell of {@link BOT_RIDE_PROBE_CELL_M} answers for the cell; a cell is
 * a tenth of the march step, so the answer is the one the march would have
 * found a step later at most. The key packs the cell's three indices and the
 * box (the scan uses three) into one number: no string, no hashing collision.
 */
const cachedProbe = (nav: BotTrack["nav"]): Probe => {
  const cells = new Map<number, Vec3 | null>();
  const boxes: number[] = [];
  return (p, box) => {
    let b = boxes.indexOf(box.x);
    if (b < 0) {
      boxes.push(box.x);
      b = boxes.length - 1;
    }
    const ix = Math.round(p.x / BOT_RIDE_PROBE_CELL_M) + 32768;
    const iz = Math.round(p.z / BOT_RIDE_PROBE_CELL_M) + 32768;
    const iy = Math.round(p.y / BOT_RIDE_PROBE_CELL_M) + 4096;
    const key = ((iy * 8 + b) * 65536 + iz) * 65536 + ix;
    const known = cells.get(key);
    if (known !== undefined) return known;
    const found = navFloorWithin(nav, p, box);
    cells.set(key, found);
    return found;
  };
};

/** The component of a transfer end: no still floor, so no walk ever joins it. */
export const TRANSFER_COMPONENT = -1;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

const round2 = (n: number): number => Math.round(n * 100) / 100;
const pointKey = (p: Vec3): string => `${round2(p.x)},${round2(p.y)},${round2(p.z)}`;

const tables = new WeakMap<BotTrack, RideTable>();

/** The ride table of `track`, built on first asking. */
export const rideTableOf = (track: BotTrack): RideTable => {
  let table = tables.get(track);
  if (table === undefined) {
    table = buildRideTable(track);
    tables.set(track, table);
  }
  return table;
};

const buildRideTable = (track: BotTrack): RideTable => {
  const started = performance.now();
  const { nav, moving } = track;
  const probe = cachedProbe(nav);
  const walks = new Map<string, number | null>();
  const walk = (a: Vec3, b: Vec3): number | null => {
    const ka = pointKey(a);
    const kb = pointKey(b);
    const key = ka < kb ? `${ka}>${kb}` : `${kb}>${ka}`;
    const known = walks.get(key);
    if (known !== undefined) return known;
    const path = navPath(nav, a, b);
    const last = path?.at(-1);
    const length = path === null || last === undefined || Math.hypot(last.x - b.x, last.z - b.z) > BOT_LEG_JOINED_M || Math.abs(last.y - b.y) > BOT_LEG_JOINED_M ? null : pathLength(path);
    walks.set(key, length);
    return length;
  };

  // Components of still floor, by representative: a new still joins the first representative a walk reaches.
  const reps: Vec3[] = [];
  const cells = new Map<string, number>();
  const componentOf = (p: Vec3): number => {
    const cell = `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`;
    const known = cells.get(cell);
    if (known !== undefined) return known;
    let found = reps.findIndex((rep) => walk(rep, p) !== null);
    if (found < 0) {
      reps.push(p);
      found = reps.length - 1;
    }
    cells.set(cell, found);
    return found;
  };

  const decks = moving.platforms.map(deckOf);
  const ends: RideEnd[] = [];
  const component: number[] = [];
  for (const platform of moving.platforms) {
    const deck = decks[platform.index]!;
    const rim = rimOf(deck);
    const candidates: { end: Omit<RideEnd, "hits" | "openPhases">; hits: number; phases: number[] }[] = [];
    for (let phase = 0; phase < platform.periodTicks; phase += BOT_RIDE_PHASE_STEP_TICKS) {
      for (const { local, outward } of rim) {
        const w = moving.toWorld(platform, phase, null, local);
        const tip = moving.toWorld(platform, phase, null, addVec3(local, outward));
        const o = { x: tip.x - w.x, z: tip.z - w.z };
        const walkAt = { x: w.x + o.x * (BOT_RIDE_WALK_GAP_M + 0.5), y: w.y, z: w.z + o.z * (BOT_RIDE_WALK_GAP_M + 0.5) };
        let still = probe(walkAt, { x: 0.6, y: BOT_RIDE_TOP_TOLERANCE_M, z: 0.6 });
        // A walk end only where the walk's contact can open: the floor point within the walk gap of the hull itself
        // (measured on a turntable: ends at the lane's corners, 1.2 m off the disc, never opened; the Bots gave up and walked off).
        if (still !== null && hullDistance(deck.hull, moving.toLocal(platform, phase, null, still)) > BOT_RIDE_WALK_GAP_M) still = null;
        let jump = false;
        if (still === null) {
          const out = BOT_RIDE_JUMP_REACH_M / 2 + BOT_LINK_RUNUP_M;
          const jumpAt = { x: w.x + o.x * out, y: w.y, z: w.z + o.z * out };
          still = probe(jumpAt, { x: BOT_RIDE_JUMP_REACH_M / 2, y: BOT_RIDE_TOP_TOLERANCE_M, z: BOT_RIDE_JUMP_REACH_M / 2 });
          if (still !== null) still = runUpBack(probe, still, o);
          jump = true;
        }
        if (still === null) continue;
        const same = candidates.find(
          (c) => c.end.jump === jump && Math.hypot(c.end.local.x - local.x, c.end.local.z - local.z) <= 1 && Math.hypot(c.end.still.x - still!.x, c.end.still.z - still!.z) <= 1,
        );
        if (same !== undefined) {
          same.hits += 1;
          if (same.phases[same.phases.length - 1] !== phase) same.phases.push(phase);
        } else candidates.push({ end: { platform: platform.index, local, outward, still, jump, to: null }, hits: 1, phases: [phase] });
      }
    }
    // The cap: round-robin across the still floors the ends meet, most-open first, spread out along each.
    const byComponent = new Map<number, typeof candidates>();
    for (const c of candidates.sort((a, b) => b.hits - a.hits || Number(a.end.jump) - Number(b.end.jump))) {
      const id = componentOf(c.end.still);
      const list = byComponent.get(id);
      if (list === undefined) byComponent.set(id, [c]);
      else list.push(c);
    }
    // A jump end only where no walk end meets the same still floor: a walk on
    // beats a jump on wherever the rim comes within a step (measured on a
    // turntable: jumped onto, 3 of 12 HARD Bots staggered on landing or were
    // pinned in the deck's seams; walked onto, none).
    for (const [id, list] of byComponent) {
      if (list.some((c) => !c.end.jump)) byComponent.set(id, list.filter((c) => !c.end.jump));
    }
    const picked: { end: RideEnd; component: number }[] = [];
    for (const spread of [2, 1, 0]) {
      let added = true;
      while (added && picked.length < BOT_RIDE_ENDS_MAX) {
        added = false;
        for (const [id, list] of byComponent) {
          if (picked.length >= BOT_RIDE_ENDS_MAX) break;
          const next = list.findIndex((c) => !picked.some((p) => p.component === id && Math.hypot(p.end.still.x - c.end.still.x, p.end.still.z - c.end.still.z) < spread));
          if (next < 0) continue;
          const [c] = list.splice(next, 1);
          picked.push({ end: { ...c!.end, hits: c!.hits, openPhases: c!.phases }, component: id });
          added = true;
        }
      }
    }
    for (const p of picked) {
      ends.push(p.end);
      component.push(p.component);
    }
  }

  const stillMs = performance.now() - started;
  // Transfer ends (M17 ticket 07e): where two platforms' rims come within jump reach of each other, one end on each, mirrored.
  const mirror: number[] = ends.map(() => -1);
  const rims = decks.map(rimOf);
  for (let a = 0; a < moving.platforms.length; a += 1) {
    for (let b = a + 1; b < moving.platforms.length; b += 1) {
      const P = moving.platforms[a]!;
      const Q = moving.platforms[b]!;
      for (const pair of transferPairs(track, P, Q, decks, rims)) {
        const { p, q, hits, phasesP, phasesQ } = pair;
        const i = ends.length;
        ends.push({ platform: a, local: p.local, outward: p.outward, still: moving.toWorld(P, 0, null, p.local), jump: true, hits, to: { platform: b, local: q.local }, openPhases: phasesP });
        ends.push({ platform: b, local: q.local, outward: q.outward, still: moving.toWorld(Q, 0, null, q.local), jump: true, hits, to: { platform: a, local: p.local }, openPhases: phasesQ });
        component.push(TRANSFER_COMPONENT, TRANSFER_COMPONENT);
        mirror.push(i + 1, i);
      }
    }
  }

  const transferMs = performance.now() - started - stillMs;
  // Rides: every ordered pair of one platform's ends the navmesh does not already join in less than a link would save.
  const links: RideLink[] = [];
  for (let i = 0; i < ends.length; i += 1) {
    for (let k = 0; k < ends.length; k += 1) {
      const entry = ends[i]!;
      const exit = ends[k]!;
      if (i === k || entry.platform !== exit.platform) continue;
      if (component[i] !== TRANSFER_COMPONENT && component[i] === component[k]) {
        const straight = Math.hypot(exit.still.x - entry.still.x, exit.still.z - entry.still.z);
        if (straight < BOT_LINK_MIN_SAVING_M) {
          const length = walk(entry.still, exit.still);
          if (length !== null && length < BOT_LINK_MIN_SAVING_M) continue;
        }
      }
      const across = Math.hypot(exit.local.x - entry.local.x, exit.local.z - entry.local.z);
      links.push({ entry, exit, across, wait: waitAt(entry, exit, across, moving.platforms[entry.platform]!.periodTicks) });
    }
  }
  // Relative to the entry's best exit (see `RideLink.wait`).
  const leastWait = new Map<RideEnd, number>();
  for (const link of links) leastWait.set(link.entry, Math.min(leastWait.get(link.entry) ?? Infinity, link.wait));
  for (const [i, link] of links.entries()) links[i] = { ...link, wait: link.wait - leastWait.get(link.entry)! };
  return { ends, links, decks, buildMs: performance.now() - started, transferMs, component, mirror, walk, componentOf };
};

/** Ticks a Bot walks `metres` in, at walking pace. */
const walkTicks = (metres: number): number => metres / (WALK_SPEED * TICK_DT);

/**
 * The wait at `exit` for a ride boarded at `entry`, in metres of walk: over
 * the entry's open phases, the Ticks from arriving at the exit (a jump's
 * flight, then `across` at walking pace) to the exit's next open phase,
 * averaged; 0 when either end's phases are unknown.
 */
const waitAt = (entry: RideEnd, exit: RideEnd, across: number, periodTicks: number): number => {
  if (entry.openPhases.length === 0 || exit.openPhases.length === 0 || periodTicks <= 0) return 0;
  const travel = BOT_RIDE_JUMP_FLIGHT_TICKS + walkTicks(across);
  let total = 0;
  for (const e of entry.openPhases) {
    const arrive = (e + travel) % periodTicks;
    let least = Infinity;
    for (const x of exit.openPhases) {
      const wait = (((x - arrive) % periodTicks) + periodTicks) % periodTicks;
      if (wait < least) least = wait;
    }
    total += least;
  }
  return (total / entry.openPhases.length) * TICK_DT * WALK_SPEED;
};

type RimPoint = { local: Vec3; outward: Vec3 };

/**
 * The rim pairs of platforms `P` and `Q` that come within
 * {@link BOT_RIDE_JUMP_REACH_M} of each other at some Tick, `Q`'s rim read a
 * flight later than `P`'s (the jump's own duration), sampled over their
 * shared cycle (capped at {@link BOT_TRANSFER_SCAN_TICKS}). Pairs are merged
 * within a metre on both rims, and capped at {@link BOT_RIDE_ENDS_MAX}, the
 * most-met first and spread along `P`'s rim: a Bot aboard `P` rides to one
 * of them and waits for it to meet `Q`, so a few around the rim keep the
 * wait short.
 */
type TransferPair = { p: RimPoint; q: RimPoint; hits: number; phasesP: number[]; phasesQ: number[] };

const transferPairs = (track: BotTrack, P: Platform, Q: Platform, decks: readonly RideDeck[], rims: readonly RimPoint[][]): TransferPair[] => {
  const { moving } = track;
  const reach = (deck: RideDeck): number => Math.max(...deck.hull.map((v) => Math.hypot(v.x - deck.centroid.x, v.z - deck.centroid.z)));
  const deckP = decks[P.index]!;
  const deckQ = decks[Q.index]!;
  const cP = moving.toWorld(P, 0, null, { x: deckP.centroid.x, y: deckP.y, z: deckP.centroid.z });
  const cQ = moving.toWorld(Q, 0, null, { x: deckQ.centroid.x, y: deckQ.y, z: deckQ.centroid.z });
  // Only platforms whose rest footprints are near each other; a slide is allowed its whole travel by the extra reach.
  const travel = (platform: Platform): number => {
    let most = 0;
    const origin = moving.toWorld(platform, 0, null, { x: 0, y: 0, z: 0 });
    for (let t = 0; t < platform.periodTicks; t += BOT_RIDE_PHASE_STEP_TICKS * 4) {
      const p = moving.toWorld(platform, t, null, { x: 0, y: 0, z: 0 });
      most = Math.max(most, Math.hypot(p.x - origin.x, p.z - origin.z));
    }
    return most;
  };
  if (Math.hypot(cQ.x - cP.x, cQ.z - cP.z) - reach(deckP) - reach(deckQ) - travel(P) - travel(Q) > BOT_RIDE_JUMP_REACH_M + 2) return [];
  if (Math.abs(cQ.y - cP.y) > BOT_RIDE_TOP_TOLERANCE_M) return [];
  const rimP = rims[P.index]!;
  const rimQ = rims[Q.index]!;
  const reachQ = reach(deckQ) + BOT_RIDE_JUMP_REACH_M;
  const scan = Math.min(BOT_TRANSFER_SCAN_TICKS, (P.periodTicks * Q.periodTicks) / gcd(P.periodTicks, Q.periodTicks));
  // Rim points are a metre apart, so a pair of them is its own merge cell.
  const hits = new Uint16Array(rimP.length * rimQ.length);
  const wq: Vec3[] = new Array<Vec3>(rimQ.length);
  for (let tick = 0; tick < scan; tick += BOT_RIDE_PHASE_STEP_TICKS) {
    const later = tick + BOT_RIDE_JUMP_FLIGHT_TICKS;
    const centreQ = moving.toWorld(Q, later, null, { x: deckQ.centroid.x, y: deckQ.y, z: deckQ.centroid.z });
    let posed = false;
    for (let i = 0; i < rimP.length; i += 1) {
      const wp = moving.toWorld(P, tick, null, rimP[i]!.local);
      // Only a rim point of P that could reach Q at all this Tick looks at Q's rim.
      if (Math.hypot(centreQ.x - wp.x, centreQ.z - wp.z) > reachQ) continue;
      if (!posed) {
        for (let k = 0; k < rimQ.length; k += 1) wq[k] = moving.toWorld(Q, later, null, rimQ[k]!.local);
        posed = true;
      }
      for (let k = 0; k < rimQ.length; k += 1) {
        const w = wq[k]!;
        if (Math.hypot(w.x - wp.x, w.z - wp.z) <= BOT_RIDE_JUMP_REACH_M) hits[i * rimQ.length + k] = hits[i * rimQ.length + k]! + 1;
      }
    }
  }
  const candidates: TransferPair[] = [];
  for (let i = 0; i < rimP.length; i += 1) {
    for (let k = 0; k < rimQ.length; k += 1) {
      const n = hits[i * rimQ.length + k]!;
      if (n > 0) candidates.push({ p: rimP[i]!, q: rimQ[k]!, hits: n, phasesP: [], phasesQ: [] });
    }
  }
  candidates.sort((x, y) => y.hits - x.hits);
  const picked: typeof candidates = [];
  for (const spread of [2, 1, 0]) {
    for (const c of candidates) {
      if (picked.length >= BOT_RIDE_ENDS_MAX) break;
      if (picked.includes(c)) continue;
      if (picked.some((o) => Math.hypot(o.p.local.x - c.p.local.x, o.p.local.z - c.p.local.z) < spread)) continue;
      picked.push(c);
    }
  }
  // The picked pairs' open phases (M17 ticket 07d), each in its own platform's period: the same scan, over the few kept.
  for (const c of picked) {
    const seenP = new Set<number>();
    const seenQ = new Set<number>();
    for (let tick = 0; tick < scan; tick += BOT_RIDE_PHASE_STEP_TICKS) {
      const later = tick + BOT_RIDE_JUMP_FLIGHT_TICKS;
      const wp = moving.toWorld(P, tick, null, c.p.local);
      const w = moving.toWorld(Q, later, null, c.q.local);
      if (Math.hypot(w.x - wp.x, w.z - wp.z) > BOT_RIDE_JUMP_REACH_M) continue;
      seenP.add(tick % P.periodTicks);
      seenQ.add(later % Q.periodTicks);
    }
    c.phasesP = [...seenP].sort((x, y) => x - y);
    c.phasesQ = [...seenQ].sort((x, y) => x - y);
  }
  return picked;
};

/** How far `p` (platform frame) lies outside `hull`, 0 inside; and how far inside, 0 outside: one signed distance, negative inside. */
export const hullDistance = (hull: readonly XZ[], p: XZ): number => {
  let inside = Infinity;
  let outside = 0;
  let isIn = true;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const length = Math.hypot(ex, ez);
    const signed = (ex * (p.z - a.z) - ez * (p.x - a.x)) / length;
    if (signed < 0) isIn = false;
    inside = Math.min(inside, signed);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / (length * length)));
    const d = Math.hypot(p.x - (a.x + ex * t), p.z - (a.z + ez * t));
    outside = i === 0 ? d : Math.min(outside, d);
  }
  return isIn ? -inside : outside;
};

/** The point of `hull`'s outline nearest `p`, and that edge's outward normal. */
export const nearestRim = (hull: readonly XZ[], p: XZ): { point: XZ; outward: XZ } => {
  let best = Infinity;
  let point: XZ = hull[0]!;
  let outward: XZ = { x: 1, z: 0 };
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const lengthSq = ex * ex + ez * ez;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / lengthSq));
    const q = { x: a.x + ex * t, z: a.z + ez * t };
    const d = Math.hypot(p.x - q.x, p.z - q.z);
    if (d < best) {
      best = d;
      point = q;
      const length = Math.sqrt(lengthSq);
      outward = { x: ez / length, z: -ex / length };
    }
  }
  return { point, outward };
};

/** `p` moved `metres` toward `centre` in the platform frame, never past it. */
export const insetToward = (p: XZ, centre: XZ, metres: number): XZ => {
  const dx = centre.x - p.x;
  const dz = centre.z - p.z;
  const length = Math.hypot(dx, dz);
  if (length <= metres) return { x: centre.x, z: centre.z };
  return { x: p.x + (dx / length) * metres, z: p.z + (dz / length) * metres };
};

