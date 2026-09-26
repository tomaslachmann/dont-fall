import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { BotLevel } from "../match/LobbyBots.js";
import { resolveRoundRules } from "../match/RoundRules.js";
import type { Vec3 } from "../math/vec3.js";
import { RapierSimulation, initPhysics } from "../simulation/RapierSimulation.js";
import type { SimInputs } from "../simulation/SimInputs.js";
import type { CharacterSnapshot, SimState } from "../state/SimState.js";
import type { ConveyorBelt } from "../track/Conveyor.js";
import type { Module } from "../track/Module.js";
import { loadAssetLibrary } from "../track/assetModules.js";
import { resolveTrack } from "../track/resolveTrack.js";
import { trackSpawn, type Track } from "../track/Track.js";
import { BOT_RIDE_TOP_TOLERANCE_M } from "../tuning/bots.js";
import { CAPSULE_BOTTOM_OFFSET, CAPSULE_RADIUS } from "../tuning/character.js";
import { TICK_DT, TICK_RATE_HZ } from "../tuning/clock.js";
import { ELIMINATION_CREDIT_TICKS } from "../tuning/fight.js";
import { buildBotTrack, type Bot, type BotTrack } from "./Bot.js";
import { HarnessProbes, type ImpactRecord, type StepOffTrace } from "./harnessProbes.js";
import { LinkReplay } from "./links.js";
import { initNavigation } from "./navMesh.js";
import { withPerceptionDelay } from "./perceptionDelay.js";
import { botProfile, type BotProfile } from "./profile.js";
import { TreeBot } from "./TreeBot.js";

/*
 * The section harness (M17 ticket 07, §6 of the groundwork): one leg of a
 * Track, twelve Bots, a cap, and every Fall put down to its cause — what each
 * part's suite (07a–07f) runs its small Tracks and its one real leg through.
 * Not a test itself: tests import it.
 */

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
const RULES = resolveRoundRules({ timeLimitMs: 300_000, fallBehavior: "respawn", survivorTarget: 1 });

let library: Promise<Record<string, Module>> | undefined;

/**
 * The whole Asset library from the repo's `assets/`, loaded once per process
 * with Rapier and Recast: the boilerplate every Bot suite copied until now.
 */
export const loadTestLibrary = (): Promise<Record<string, Module>> =>
  (library ??= (async () => {
    await Promise.all([initPhysics(), initNavigation()]);
    return loadAssetLibrary(
      async (url) => new Uint8Array(readFileSync(join(assetsRoot, url.substring(url.lastIndexOf("/") + 1)))),
      "http://assets.test",
    );
  })());

export interface SectionRun {
  /** Motion running unless `atRest(track)` was passed. */
  track: Track;
  /** Defaults to {@link loadTestLibrary}'s. */
  library?: Record<string, Module>;
  /** Built once per Track object and kept, when not given: a suite file's Tracks are built once. */
  botTrack?: BotTrack;
  /**
   * Which leg: spawn on Checkpoint `leg - 1`'s Respawn deck in a 4 × 3 grid
   * (1.1 m apart; the Respawn lies before its arch, so the first thing every
   * Bot does is cross it for real); the Start for leg 0. Pass =
   * `checkpointIndex ≥ leg`, or `finishTick` past the last Checkpoint.
   */
  leg: number;
  level: BotLevel;
  seed: string;
  /** Defaults to 12. */
  bots?: number;
  capSeconds: number;
  /** Default: `botProfile(level, seed)` with aggression 0. */
  profile?: (level: BotLevel, seed: string) => BotProfile;
  /** M17 ticket 07d: the whole Race — spawn at the Start (`leg` 0) and pass only at the finish. */
  whole?: boolean;
  /** Log every Impact of Stagger strength a Bot takes on its feet (`harnessProbes.ts`). Off by default, and free when off. */
  impactLog?: boolean;
  /** Trace every `step-off` Fall Tick by Tick, with the ground it left (`harnessProbes.ts`). Off by default, and free when off. */
  stepOffTrace?: boolean;
}

export interface SectionOutcome {
  passed: number;
  /** Unpassed and less than a metre moved over the last ten seconds at the cap. */
  stranded: number;
  /** Unpassed, still getting somewhere. */
  slow: number;
  /** Ticket 06's classifier: a `RagdollCause` | Bump | Stagger | Hit | Held | link | belt | contact | pushed | step-off. */
  falls: Record<string, number>;
  /** The Tick each passing Bot passed on, in Bot order. */
  passTicks: number[];
  thinkUsPerBotTick: number;
  /** Where each Fall left the ground from. */
  where: string[];
  /** M17 ticket 07d: Falls by cause per section, keyed by the section the Bot was in (`checkpointIndex + 1`: 0 is Start → Checkpoint 0). */
  sections: Record<number, Record<string, number>>;
  /** With `impactLog`: every Impact of Stagger strength, joined to the Fall it led to. */
  impacts?: ImpactRecord[];
  /** With `impactLog`: every Bump between Characters, of any strength. */
  bumps?: number;
  /** With `stepOffTrace`: one trace per `step-off` Fall. */
  stepOffs?: StepOffTrace[];
}

/** One section of a Race in a report (M17 ticket 07d; ticket 11 prints it): between two Checkpoints, its Falls by cause. */
export interface SectionFalls {
  /** The section's index: 0 is Start → Checkpoint 0. */
  section: number;
  from: string;
  to: string;
  falls: Record<string, number>;
  total: number;
}

/** A whole Race's report (M17 ticket 07d): what ticket 11's `bots:track` prints and a Track's suite asserts on. */
export interface RaceReport {
  level: BotLevel;
  bots: number;
  finished: number;
  stranded: number;
  slow: number;
  /** Seconds from the Start, per finishing Bot, sorted. */
  finishSeconds: number[];
  /** The Race's clock, in seconds. */
  timeLimitSeconds: number;
  falls: Record<string, number>;
  ownFalls: number;
  obstacleFalls: number;
  sections: SectionFalls[];
  thinkUsPerBotTick: number;
}

/**
 * The whole Race (M17 ticket 07d): `bots` Bots from the Start, Motion
 * running, until every Bot has finished or the Track's Time Limit is up, with
 * every Fall put down to its cause and its section. The one function ticket
 * 11's report and the level-ordering suite read.
 */
export const playRace = async (run: Omit<SectionRun, "leg" | "whole" | "capSeconds"> & { timeLimitSeconds: number }): Promise<RaceReport> => {
  const outcome = await playSection({ ...run, leg: 0, whole: true, capSeconds: run.timeLimitSeconds });
  const library = run.library ?? (await loadTestLibrary());
  const { resolved } = run.botTrack ?? sectionBotTrack(run.track, library);
  const name = (i: number): string => (i < 0 ? "Start" : i >= resolved.checkpoints.length ? "Finish" : `Checkpoint ${i}`);
  const sections: SectionFalls[] = [];
  for (let i = 0; i <= resolved.checkpoints.length; i += 1) {
    const falls = outcome.sections[i] ?? {};
    sections.push({ section: i, from: name(i - 1), to: name(i), falls, total: Object.values(falls).reduce((a, b) => a + b, 0) });
  }
  return {
    level: run.level,
    bots: run.bots ?? 12,
    finished: outcome.passed,
    stranded: outcome.stranded,
    slow: outcome.slow,
    finishSeconds: [...outcome.passTicks].sort((a, b) => a - b).map((t) => t * TICK_DT),
    timeLimitSeconds: run.timeLimitSeconds,
    falls: outcome.falls,
    ownFalls: ownFalls(outcome.falls),
    obstacleFalls: obstacleFalls(outcome.falls),
    sections,
    thinkUsPerBotTick: outcome.thinkUsPerBotTick,
  };
};

/** Falls that are not a Bot's own: another Character's Bump or contact, a belt, a push. */
const NOT_ITS_OWN = new Set(["Bump", "contact", "pushed", "belt"]);
/** Falls a moving obstacle or a trap dealt. */
const OBSTACLE = new Set(["Obstacle", "WallImpact", "Stagger", "pushed", "Spiked", "Blast"]);

/** Everything but Bump, contact, pushed, belt. */
export const ownFalls = (falls: Record<string, number>): number =>
  Object.entries(falls).reduce((sum, [cause, n]) => sum + (NOT_ITS_OWN.has(cause) ? 0 : n), 0);

/** Obstacle + WallImpact + Stagger + pushed + Spiked (+ Blast). */
export const obstacleFalls = (falls: Record<string, number>): number =>
  Object.entries(falls).reduce((sum, [cause, n]) => sum + (OBSTACLE.has(cause) ? n : 0), 0);

// The classifier's own reaches, as ticket 06's suite settled them.
const LINK_BLAME_TICKS = 5;
const BUMP_REACH_M = 1.2;
const CONTACT_BLAME_TICKS = 10;
const PUSH_MIN_M = 0.05;
const PUSH_BLAME_TICKS = 30;
const BELT_BLAME_TICKS = 90;
const BELT_REACH_M = CAPSULE_RADIUS + 0.2;
/** Stranded: less than this moved over the last {@link STRANDED_WINDOW_S}. */
const STRANDED_MOVE_M = 1;
const STRANDED_WINDOW_S = 10;
/** The spawn grid on a Respawn deck: 4 across, 3 back. */
const GRID_SPACING_M = 1.1;
const YIELD_TICKS = 600;

const onBelt = (belts: readonly ConveyorBelt[], position: Vec3): boolean =>
  belts.some(({ deck: { center, yaw, halfX, halfZ } }) => {
    if (Math.abs(position.y - CAPSULE_BOTTOM_OFFSET - center.y) > 1.5) return false;
    const dx = position.x - center.x;
    const dz = position.z - center.z;
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    return Math.abs(lx) <= halfX + BELT_REACH_M && Math.abs(lz) <= halfZ + BELT_REACH_M;
  });

const builtTracks = new WeakMap<Track, BotTrack>();

/** The {@link BotTrack} of `track`, built on first asking and kept for the Track object's life. */
export const sectionBotTrack = (track: Track, library: Record<string, Module>): BotTrack => {
  let built = builtTracks.get(track);
  if (built === undefined) {
    built = buildBotTrack(resolveTrack(library, track));
    builtTracks.set(track, built);
  }
  return built;
};

/**
 * Plays one section (M17 ticket 07): `bots` Bots spawned for `leg`, the
 * Round RUNNING from Tick 0 with the Motion Clock at 0, until every Bot has
 * passed or `capSeconds` are up. The view every Bot gets carries
 * `runningFromTick: sim.motionClock` and `fragile: state.fragile`, and
 * `syncFragile` runs each Tick, as the Match's driver does.
 *
 * A Bot spawned past the Start has passed nothing the simulation knows of,
 * so its view's `checkpointIndex` is raised to `leg - 1`: the Race goal then
 * runs the leg asked for rather than back to Checkpoint 0.
 */
export const playSection = async (run: SectionRun): Promise<SectionOutcome> => {
  const library = run.library ?? (await loadTestLibrary());
  const { track, leg, level, seed, capSeconds } = run;
  const count = run.bots ?? 12;
  const botTrack = run.botTrack ?? sectionBotTrack(track, library);
  const { resolved } = botTrack;
  const profileOf = run.profile ?? ((l: BotLevel, s: string): BotProfile => ({ ...botProfile(l, s), aggression: 0 }));
  const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false, motionClock: 0 });
  const bots = new Map<string, Bot>();
  const respawn = leg > 0 ? resolved.checkpoints[leg - 1]?.respawn : undefined;
  if (leg > 0 && respawn === undefined) throw new Error(`leg ${leg}: the Track has no Checkpoint ${leg - 1}`);
  for (let i = 0; i < count; i += 1) {
    const id = `bot-${i}`;
    const botSeed = `${seed}:${id}`;
    const profile = profileOf(level, botSeed);
    bots.set(id, withPerceptionDelay(new TreeBot({ seed: botSeed, profile }), profile, botSeed));
    const spawn =
      respawn === undefined
        ? trackSpawn(track, i, library)
        : { x: respawn.x + ((i % 4) - 1.5) * GRID_SPACING_M, y: respawn.y, z: respawn.z + (Math.floor(i / 4) - 1) * GRID_SPACING_M };
    sim.addCharacter(id, spawn);
  }
  const passesAt = (c: CharacterSnapshot): boolean => (run.whole !== true && (c.checkpointIndex ?? -1) >= leg) || c.finishTick !== null;
  const steps = LinkReplay.prototype.step;
  let linkSteps = 0;
  LinkReplay.prototype.step = function (this: LinkReplay) {
    linkSteps += 1;
    return steps.call(this);
  };
  const falls: Record<string, number> = {};
  const sections: Record<number, Record<string, number>> = {};
  const where: string[] = [];
  const touched = new Map<string, { tick: number; cause: string }>();
  const lastLink = new Map<string, number>();
  const lastGround = new Map<string, { tick: number; position: Vec3 }>();
  const lastBelt = new Map<string, number>();
  const lastContact = new Map<string, number>();
  const lastPushed = new Map<string, number>();
  const passTick = new Map<string, number>();
  /** Where each Bot was `STRANDED_WINDOW_S` ago, a ring of positions. */
  const trail = new Map<string, Vec3[]>();
  const windowTicks = Math.round(STRANDED_WINDOW_S * TICK_RATE_HZ);
  const probes = new HarnessProbes(sim, botTrack, { impactLog: run.impactLog === true, stepOffTrace: run.stepOffTrace === true });
  let state: SimState = sim.snapshot();
  let thinkMs = 0;
  let thinks = 0;
  const ticks = Math.round(capSeconds / TICK_DT);
  try {
    probes.install();
    for (let n = 0; n < ticks; n += 1) {
      if (n % YIELD_TICKS === 0) await new Promise((resolve) => setImmediate(resolve));
      const inputs: Record<string, SimInputs> = {};
      let running = 0;
      botTrack.moving.syncFragile(botTrack.nav, state.fragile);
      for (const [id, bot] of bots) {
        const self = state.characters[id]!;
        if (passTick.has(id)) continue;
        running += 1;
        const before = linkSteps;
        const seen: CharacterSnapshot = (self.checkpointIndex ?? -1) < leg - 1 ? { ...self, checkpointIndex: leg - 1 } : self;
        const started = performance.now();
        inputs[id] = bot.think({
          tick: state.tick + 1,
          id,
          self: seen,
          characters: state.characters,
          props: state.props,
          bombs: state.bombs ?? [],
          track: botTrack,
          rules: RULES,
          runningFromTick: sim.motionClock,
          fragile: state.fragile,
        });
        thinkMs += performance.now() - started;
        thinks += 1;
        if (linkSteps > before) lastLink.set(id, state.tick);
      }
      if (running === 0) break;
      sim.tick(inputs, "RUNNING");
      const next = sim.snapshot();
      if (probes.on) probes.tick(next);
      for (const id of bots.keys()) {
        const before = state.characters[id]!;
        const after = next.characters[id]!;
        if (!passTick.has(id) && passesAt(after)) passTick.set(id, next.tick);
        const touching = Object.entries(next.characters).some(
          ([other, c]) => other !== id && !c.eliminated && Math.hypot(c.position.x - after.position.x, c.position.z - after.position.z) < BUMP_REACH_M,
        );
        if (touching) lastContact.set(id, next.tick);
        // A deck carries what stands on it (`velocity` is the Character's own): moved further than both is a push (M17 ticket 07b).
        const deck = botTrack.moving.platformUnder(before.position, state.tick, sim.motionClock, BOT_RIDE_TOP_TOLERANCE_M);
        const carry = deck === null ? undefined : botTrack.moving.velocityAt(deck.bodies[0]!.index, state.tick, sim.motionClock, before.position);
        const ownRun = Math.hypot(after.velocity.x + (carry?.x ?? 0), after.velocity.z + (carry?.z ?? 0)) * TICK_DT;
        const moved = Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z);
        if (moved > ownRun + PUSH_MIN_M) lastPushed.set(id, next.tick);
        if (after.ragdollEpoch > before.ragdollEpoch && after.ragdollCause !== "Fall") {
          touched.set(id, { tick: next.tick, cause: after.ragdollCause === "WallImpact" && touching ? "Bump" : after.ragdollCause });
        } else if (after.motionState === "Held" && before.motionState !== "Held") touched.set(id, { tick: next.tick, cause: "Held" });
        else if (after.hitReactEpoch > before.hitReactEpoch) touched.set(id, { tick: next.tick, cause: "Hit" });
        else if (after.motionState === "Stagger" && before.motionState !== "Stagger") {
          touched.set(id, { tick: next.tick, cause: touching ? "Bump" : "Stagger" });
        }
        if (before.grounded && (before.motionState === "Controlled" || before.motionState === "Sliding")) {
          lastGround.set(id, { tick: state.tick, position: before.position });
        }
        if (onBelt(resolved.conveyors, before.position)) lastBelt.set(id, state.tick);
        const ring = trail.get(id) ?? [];
        ring.push(after.position);
        if (ring.length > windowTicks) ring.shift();
        trail.set(id, ring);
        if (after.fallCount > before.fallCount) {
          const touch = touched.get(id);
          const ground = lastGround.get(id);
          let cause: string;
          if (touch !== undefined && (next.tick - touch.tick <= ELIMINATION_CREDIT_TICKS || touch.tick > (ground?.tick ?? -Infinity))) cause = touch.cause;
          else if ((lastLink.get(id) ?? -Infinity) >= (ground?.tick ?? 0) - LINK_BLAME_TICKS) cause = "link";
          else if ((lastBelt.get(id) ?? -Infinity) >= (ground?.tick ?? 0) - BELT_BLAME_TICKS) cause = "belt";
          else if ((lastContact.get(id) ?? -Infinity) >= (ground?.tick ?? 0) - CONTACT_BLAME_TICKS) cause = "contact";
          else if ((lastPushed.get(id) ?? -Infinity) >= (ground?.tick ?? 0) - PUSH_BLAME_TICKS) cause = "pushed";
          else cause = "step-off";
          falls[cause] = (falls[cause] ?? 0) + 1;
          const section = Math.max(leg, (before.checkpointIndex ?? -1) + 1);
          const inSection = (sections[section] ??= {});
          inSection[cause] = (inSection[cause] ?? 0) + 1;
          const at = ground?.position ?? before.position;
          where.push(`${id} ${cause} at (${at.x.toFixed(1)}, ${at.y.toFixed(1)}, ${at.z.toFixed(1)}) tick ${ground?.tick}`);
          if (probes.on) probes.fell(id, cause, ground, next.tick, before.motionState);
        }
      }
      state = next;
    }
  } finally {
    probes.restore();
    LinkReplay.prototype.step = steps;
    sim.dispose();
  }
  let stranded = 0;
  let slow = 0;
  for (const id of bots.keys()) {
    if (passTick.has(id)) continue;
    const ring = trail.get(id) ?? [];
    const first = ring[0];
    const last = ring[ring.length - 1];
    const moved = first === undefined || last === undefined ? Infinity : Math.hypot(last.x - first.x, last.z - first.z);
    if (ring.length >= windowTicks && moved < STRANDED_MOVE_M) stranded += 1;
    else slow += 1;
    const c = state.characters[id]!;
    where.push(`${id} unpassed at the cap: (${c.position.x.toFixed(1)}, ${c.position.y.toFixed(1)}, ${c.position.z.toFixed(1)}) checkpoint ${c.checkpointIndex ?? -1} ${c.motionState} moved ${moved.toFixed(1)} m in the last ${STRANDED_WINDOW_S} s`);
  }
  return {
    passed: passTick.size,
    stranded,
    slow,
    falls,
    passTicks: [...bots.keys()].filter((id) => passTick.has(id)).map((id) => passTick.get(id)!),
    thinkUsPerBotTick: (thinkMs * 1000) / Math.max(1, thinks),
    where,
    sections,
    ...(run.impactLog === true ? { impacts: probes.impacts, bumps: probes.bumps } : {}),
    ...(run.stepOffTrace === true ? { stepOffs: probes.stepOffs } : {}),
  };
};
