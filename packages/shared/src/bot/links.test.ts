import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resolveRoundRules } from "../match/RoundRules.js";
import type { Vec3 } from "../math/vec3.js";
import { RapierSimulation, initPhysics } from "../simulation/RapierSimulation.js";
import type { SimInputs } from "../simulation/SimInputs.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import { at, flushOn, onTop, pitchedDeck } from "../track/authoring.js";
import type { Module } from "../track/Module.js";
import { loadAssetLibrary } from "../track/assetModules.js";
import { BASE_RACE_TRACK } from "../track/baseRace.js";
import { resolveTrack } from "../track/resolveTrack.js";
import {
  FORK_ONE_ICE_DS as SLIP_ICE_DS,
  FORK_ONE_ICE_X as SLIP_ICE_X,
  FORK_ONE_BAR_DS as SLIP_LADDER_BAR_DS,
  FORK_ONE_LADDER_X as SLIP_LADDER_X,
  FORK_THREE_BELT_DS as SLIP_BELT_DS,
  FORK_THREE_BELT_X as SLIP_BELT_X,
  FORK_THREE_GAP_DS as SLIP_GAP_DS,
  FORK_THREE_GAP_X as SLIP_GAP_X,
  FORK_TWO_ARM_X as SLIP_TWO_X,
  FORK_TWO_MUD_DS as SLIP_MUD_DS,
  FORK_TWO_STONE_DS as SLIP_STONE_DS,
  FORK_TWO_UPDRAFT_DS as SLIP_UPDRAFT_DS,
  SLIP_STREAM_SECTION_STARTS,
  SLIP_STREAM_TRACK,
} from "../track/slipStream.js";
import {
  FORK_ONE_BAR_DS as SPIN_CATWALK_BAR_DS,
  FORK_ONE_LEFT_DS as SPIN_LEFT_DS,
  FORK_ONE_RIGHT_X as SPIN_RIGHT_X,
  FORK_THREE_ICE_X as SPIN_ICE_X,
  FORK_THREE_MUD_X as SPIN_MUD_X,
  FORK_TWO_ARM_X as SPIN_TWO_X,
  FORK_TWO_BELT_DS as SPIN_BELT_DS,
  FORK_TWO_BOUNCE_DS as SPIN_BOUNCE_DS,
  FORK_TWO_GAP_DS as SPIN_GAP_DS,
  SPIN_CYCLE_SECTION_STARTS,
  SPIN_CYCLE_TRACK,
} from "../track/spinCycle.js";
import { trackSpawn, type Track } from "../track/Track.js";
import { atRest } from "../track/walkTrack.js";
import { BOT_FORK_VIA_REACHED_M } from "../tuning/bots.js";
import { TICK_DT } from "../tuning/clock.js";
import { buildBotTrack, disposeBotTrack, type BotTrack, type BotWorldView } from "./Bot.js";
import { lastLinkProofReport, provenNavLinks } from "./linkProof.js";
import { LinkReplay, type NavLinkKind } from "./links.js";
import { trackNavInput } from "./navInput.js";
import { buildTrackNav, disposeTrackNav, initNavigation } from "./navMesh.js";
import { TreeBot } from "./TreeBot.js";

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
const RULES = resolveRoundRules({ timeLimitMs: 300_000, fallBehavior: "respawn", survivorTarget: 1 });

let library: Record<string, Module>;
const built: BotTrack[] = [];
beforeAll(async () => {
  await Promise.all([initPhysics(), initNavigation()]);
  library = await loadAssetLibrary(
    async (url) => new Uint8Array(readFileSync(join(assetsRoot, url.substring(url.lastIndexOf("/") + 1)))),
    "http://assets.test",
  );
});
afterAll(() => built.forEach(disposeBotTrack));
afterEach(() => vi.restoreAllMocks());

const botTrackOf = (track: Track): BotTrack => {
  const botTrack = buildBotTrack(resolveTrack(library, track));
  built.push(botTrack);
  return botTrack;
};

interface Run {
  end: CharacterSnapshot;
  seconds: number;
  /** Every position the Bot's Character stood at, a Tick apart. */
  trail: Vec3[];
  /** How many times the Bot took each kind of link. */
  taken: Partial<Record<NavLinkKind, number>>;
  /** When each Checkpoint was reached, in seconds. */
  splits: number[];
}

/** What a link had the Bot do on a Tick it drove it: the step of its script (M17 ticket 06), `null` once played out. */
type LinkStepOf = ReturnType<LinkReplay["step"]>;

/**
 * Runs a Bot from `from` as the Match loop does, until it finishes or
 * `seconds` run out. `onTick` sees each Tick's input, and the step a link gave
 * it when a link drove that Tick.
 */
const race = (
  track: BotTrack,
  from: Vec3,
  seed: string,
  seconds = 300,
  onTick?: (input: SimInputs, linkStep: LinkStepOf | null) => void,
): Run => {
  const sim = new RapierSimulation({ ...track.resolved, withDefaultCharacter: false });
  sim.addCharacter("bot", from);
  const bot = new TreeBot({ seed });
  const trail: Vec3[] = [];
  const taken: Run["taken"] = {};
  const steps = vi.spyOn(LinkReplay.prototype, "step");
  const seen = new Set<LinkReplay>();
  const splits: number[] = [];
  let n = 0;
  try {
    for (; n < seconds / TICK_DT; n += 1) {
      const state = sim.snapshot();
      const self = state.characters.bot!;
      if (self.finishTick !== null) break;
      trail.push(self.position);
      if ((self.checkpointIndex ?? -1) >= splits.length) splits.push(n * TICK_DT);
      const view: BotWorldView = { tick: state.tick + 1, id: "bot", self, characters: state.characters, track, rules: RULES };
      const calls = steps.mock.results.length;
      const input = bot.think(view);
      const linkStep = steps.mock.results.length > calls ? (steps.mock.results.at(-1)!.value as LinkStepOf) : null;
      const run = steps.mock.contexts.at(-1) as LinkReplay | undefined;
      if (linkStep !== null && run !== undefined && !seen.has(run)) {
        seen.add(run);
        taken[run.link.kind] = (taken[run.link.kind] ?? 0) + 1;
      }
      onTick?.(input, linkStep);
      sim.tick({ bot: input }, "RUNNING");
    }
    return { end: sim.snapshot().characters.bot!, seconds: n * TICK_DT, trail, taken, splits };
  } finally {
    steps.mockRestore();
    sim.dispose();
  }
};

// --- Small Tracks that ask one question each ----------------------------------

const TOP = 4;
const START = { x: 0, y: TOP + 1, z: -3 };
const deck = (s: number, top = TOP, scale = 2) => onTop("kaykit_platform_6x6x1_blue", 0, top, s, { scale });
/** A deck 12 m long from s 0, then `gap` metres of air, then another with a finish sign on it. */
const gapTrack = (gap: number): Track => [deck(6), deck(12 + gap + 6), at("kaykit_signage_finish_wide", 0, TOP, 12 + gap + 8, { scale: 1.25 })];

describe("links the navmesh cannot see (M17 ticket 05)", () => {
  it("proves a jump across a gap, and a Bot takes it with exactly the input that proved it", () => {
    const track = botTrackOf(gapTrack(2.5));
    const jumps = track.nav.links.filter((link) => link.kind === "jump" && -link.from.z < 12 && -link.to.z > 14.5);
    expect(jumps.length).toBeGreaterThan(0);
    // Every link carries its recipe: a run-up line, where jump is pressed, no Dash;
    // and the script its proof played (M17 ticket 06), jump held in it.
    for (const link of jumps) {
      expect(Math.hypot(link.direction.x, link.direction.z)).toBeCloseTo(1, 6);
      expect(link.jumpAt).not.toBeNull();
      expect(link.dash).toBe(false);
      expect(link.script.some((step) => step.jump)).toBe(true);
    }

    const followed: { input: SimInputs; step: LinkStepOf }[] = [];
    const run = race(track, START, "jumper", 30, (input, step) => {
      if (step !== null) followed.push({ input, step });
    });
    expect(run.end.finishTick).not.toBeNull();
    expect(run.end.fallCount).toBe(0);
    expect(run.taken.jump).toBe(1);
    // The Bot's input on every Tick a link drove it is that link's script, untouched (M17 ticket 06).
    const driving = followed.filter((entry): entry is { input: SimInputs; step: NonNullable<LinkStepOf> } => entry.step !== null);
    expect(driving.length).toBeGreaterThan(10);
    for (const { input, step } of driving) {
      expect(input.moveDirection).toEqual(step.moveDirection);
      expect(input.jumpHeld).toBe(step.jump);
      expect(input.dashHeld).toBe(false);
    }
    expect(driving.some(({ input }) => input.jumpHeld)).toBe(true);
  });

  it("proves no jump across a gap wider than any jump carries, and the Bot stops at the edge", () => {
    const track = botTrackOf(gapTrack(7));
    expect(track.nav.links.filter((link) => -link.to.z > 12)).toEqual([]);
    const run = race(track, START, "jumper", 20);
    expect(run.end.fallCount).toBe(0);
    expect(run.end.finishTick).toBeNull();
    expect(-run.end.position.z).toBeGreaterThan(9);
    expect(-run.end.position.z).toBeLessThan(12);
  });

  it("slides down a Sliding ramp the navmesh leaves off (ADR 0037), and finishes", () => {
    // Steeper than a walk (35°), and longer than a jump may drop, so only a slide goes down it.
    const pitch = (-45 * Math.PI) / 180;
    const length = 9;
    const high = TOP + 8;
    const drop = length * Math.sin(-pitch);
    const run = length * Math.cos(pitch);
    const track = botTrackOf([
      deck(6, high),
      pitchedDeck("kaykit_platform_6x6x1_blue", 0, 12 + run / 2, high - drop / 2, pitch, { scale: 1.5 }),
      deck(12 + run + 6, high - drop),
      at("kaykit_signage_finish_wide", 0, high - drop, 12 + run + 8, { scale: 1.25 }),
    ]);
    expect(track.nav.links.some((link) => link.kind === "slide")).toBe(true);
    expect(track.nav.links.filter((link) => link.kind !== "slide")).toEqual([]);
    const raced = race(track, { ...START, y: high + 1 }, "slider", 30);
    expect(raced.taken.slide).toBe(1);
    expect(raced.end.finishTick).not.toBeNull();
    expect(raced.end.fallCount).toBe(0);
  });

  it("finds where a Spring lands by playing it, and rides it up a tier it cannot walk to", () => {
    const high = TOP + 6;
    const track = botTrackOf([
      deck(6),
      flushOn("kaykit_spring_pad_yellow", 0, TOP, 9, { scale: 1.5, launch: { height: 9 } }),
      deck(12 + 6, high),
      at("kaykit_signage_finish_wide", 0, high, 12 + 8, { scale: 1.25 }),
    ]);
    const launches = track.nav.links.filter((link) => link.kind === "launch");
    expect(launches.length).toBeGreaterThan(0);
    for (const link of launches) {
      expect(link.jumpAt).toBeNull();
      expect(link.to.y).toBeGreaterThan(high - 0.5);
    }
    const raced = race(track, START, "springer", 30);
    expect(raced.taken.launch).toBe(1);
    expect(raced.end.finishTick).not.toBeNull();
    expect(raced.end.fallCount).toBe(0);
  });

  it("proves a Track's links once: the same geometry again is not played", () => {
    const resolved = resolveTrack(library, gapTrack(2.5));
    const input = trackNavInput(resolved);
    const first = buildTrackNav(input, (plain) => provenNavLinks(resolved, plain, input));
    const report = lastLinkProofReport();
    const again = buildTrackNav(trackNavInput(resolveTrack(library, gapTrack(2.5))), (plain) => provenNavLinks(resolved, plain, input));
    expect(lastLinkProofReport()).toBe(report);
    expect(again.links).toBe(first.links);
    disposeTrackNav(first);
    disposeTrackNav(again);
  });
});

// --- The authored Races, at rest ----------------------------------------------

/**
 * Every Motion stopped, as `walkTrack` proves a Track: at rest a moving piece
 * is a still body, so the gaps between them are jumps. Slip Stream's Props
 * are taken off too: a Bot cannot see a Prop yet (ticket 04's open question
 * 3), and on the ice arm it runs into the bumpers along its corridor, is put
 * down by ADR 0102's crash and in the end knocked off. Seeing them is tickets
 * 06 and 07's.
 */
const STILL = {
  base: atRest(BASE_RACE_TRACK),
  spin: atRest(SPIN_CYCLE_TRACK),
  slip: atRest(SLIP_STREAM_TRACK).filter((segment) => segment.prop !== true),
};

/** An arm of a fork: a point in its middle a Bot is made to run through, where the walker runs it. */
interface Arm {
  name: string;
  x: number;
  s: number;
  /** How far above the section's own deck the arm runs. */
  rise?: number;
}

/** A fork: which section it is in, and its arms. */
interface Fork {
  s: number;
  top: number;
  arms: Arm[];
}

const middle = (values: readonly number[]): number => values[Math.floor(values.length / 2)]!;
const SPIN = SPIN_CYCLE_SECTION_STARTS;
const SLIP = SLIP_STREAM_SECTION_STARTS;
/** The forks `spinCycle.test.ts`'s walker takes each arm of, by the same layout constants. */
const SPIN_FORKS: Fork[] = [
  {
    ...SPIN.forkOne,
    arms: [
      { name: "left", x: -8, s: SPIN.forkOne.s + middle(SPIN_LEFT_DS) },
      { name: "right", x: SPIN_RIGHT_X + 3.2, s: SPIN.forkOne.s + SPIN_CATWALK_BAR_DS[1]!, rise: 6 },
    ],
  },
  {
    ...SPIN.forkTwo,
    arms: [
      { name: "belt", x: SPIN_TWO_X[0], s: SPIN.forkTwo.s + middle(SPIN_BELT_DS) },
      { name: "stones", x: SPIN_TWO_X[1], s: SPIN.forkTwo.s + middle(SPIN_GAP_DS) },
      { name: "bounce", x: SPIN_TWO_X[2], s: SPIN.forkTwo.s + middle(SPIN_BOUNCE_DS) },
    ],
  },
  {
    ...SPIN.forkThree,
    arms: [
      { name: "mud", x: SPIN_MUD_X, s: SPIN.forkThree.s + 36 },
      { name: "ice", x: SPIN_ICE_X - 1.8, s: SPIN.forkThree.s + 27 },
    ],
  },
];
/** The same for `slipStream.test.ts`'s walker. */
const SLIP_FORKS: Fork[] = [
  {
    ...SLIP.forkOne,
    arms: [
      { name: "ice", x: SLIP_ICE_X, s: SLIP.forkOne.s + middle(SLIP_ICE_DS) },
      { name: "ladder", x: SLIP_LADDER_X + 2.5, s: SLIP.forkOne.s + SLIP_LADDER_BAR_DS[1]!, rise: 6 },
    ],
  },
  {
    ...SLIP.forkTwo,
    arms: [
      { name: "updraft", x: SLIP_TWO_X[0], s: SLIP.forkTwo.s + middle(SLIP_UPDRAFT_DS) },
      { name: "stones", x: SLIP_TWO_X[1] + 2.6, s: SLIP.forkTwo.s + middle(SLIP_STONE_DS) },
      { name: "mud", x: SLIP_TWO_X[2], s: SLIP.forkTwo.s + middle(SLIP_MUD_DS) },
    ],
  },
  {
    ...SLIP.forkThree,
    arms: [
      { name: "belt", x: SLIP_BELT_X - 1, s: SLIP.forkThree.s + middle(SLIP_BELT_DS) },
      { name: "gaps", x: SLIP_GAP_X - 1, s: SLIP.forkThree.s + middle(SLIP_GAP_DS) },
    ],
  },
];

/** Where an arm runs, on the navmesh. */
const armPoint = (track: BotTrack, fork: Fork, arm: Arm): Vec3 => {
  const found = track.nav.query.findNearestPoly(
    { x: arm.x, y: fork.top + (arm.rise ?? 0), z: -arm.s },
    { halfExtents: { x: 1, y: 1, z: 1 } },
  );
  expect(found.success && found.nearestRef !== 0, `${arm.name} is on the navmesh`).toBe(true);
  return found.nearestPoint;
};

/** Which leg a fork is on: the Checkpoint after it, by `checkpointIndex`. */
const legOf = (track: BotTrack, fork: Fork): number => track.resolved.checkpoints.filter((c) => -c.respawn.z < fork.s).length;

/**
 * The walker's three sets of arms (`spinCycle.test.ts`, `slipStream.test.ts`):
 * between them every arm of every fork. A Bot is made to take a set by
 * handing it that arm as its leg's only one.
 */
const armSets = (forks: readonly Fork[]): Arm[][] =>
  [0, 1, 2].map((set) => forks.map((fork) => fork.arms[Math.min(set, fork.arms.length - 1)]!));

describe("a Bot finishes the authored Races at rest (M17 ticket 05)", () => {
  it("finishes the base race from the Start, with no Fall", () => {
    const track = botTrackOf(STILL.base);
    const run = race(track, trackSpawn(STILL.base, 0, library), "runner");
    expect(run.end.finishTick).not.toBeNull();
    expect(run.end.checkpointIndex).toBe(track.resolved.checkpoints.length - 1);
    expect(run.end.fallCount).toBe(0);
    expect(run.taken.jump).toBeGreaterThan(0);
  }, 120_000);

  for (const [name, still, forks] of [
    ["Spin Cycle", STILL.spin, SPIN_FORKS],
    ["Slip Stream", STILL.slip, SLIP_FORKS],
  ] as const) {
    it(`finishes ${name} through every arm of every fork, with no Fall`, () => {
      const track = botTrackOf(still);
      for (const arms of armSets(forks)) {
        const points = forks.map((fork, i) => armPoint(track, fork, arms[i]!));
        track.forks.clear();
        forks.forEach((fork, i) => track.forks.set(legOf(track, fork), [points[i]!]));
        const run = race(track, trackSpawn(still, 0, library), `through ${arms.map((arm) => arm.name).join(" ")}`);
        const route = arms.map((arm) => arm.name).join(" / ");
        expect(run.end.fallCount, route).toBe(0);
        expect(run.end.finishTick, `${route}: stopped at ${JSON.stringify(run.end.position)}`).not.toBeNull();
        for (const [i, point] of points.entries()) {
          const passed = run.trail.some((at) => Math.hypot(at.x - point.x, at.z - point.z) <= BOT_FORK_VIA_REACHED_M);
          expect(passed, `${route}: ran through ${arms[i]!.name}`).toBe(true);
        }
      }
    }, 300_000);
  }
});
