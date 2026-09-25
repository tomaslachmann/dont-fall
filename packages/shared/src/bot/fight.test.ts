import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveRoundRules } from "../match/RoundRules.js";
import type { Vec3 } from "../math/vec3.js";
import { RapierSimulation, initPhysics } from "../simulation/RapierSimulation.js";
import { IDLE_INPUTS, type SimInputs } from "../simulation/SimInputs.js";
import type { CharacterSnapshot, SimState } from "../state/SimState.js";
import { at, onTop, type Extra } from "../track/authoring.js";
import type { Module } from "../track/Module.js";
import { loadAssetLibrary } from "../track/assetModules.js";
import { resolveTrack } from "../track/resolveTrack.js";
import type { Track } from "../track/Track.js";
import { BOT_BEHIND_CHECKPOINTS } from "../tuning/bots.js";
import { GRAB_STRUGGLE_WINDOW_TICKS } from "../tuning/fight.js";
import { buildBotTrack, disposeBotTrack, type Bot, type BotTrack, type BotWorldView } from "./Bot.js";
import { Fighter } from "./fight.js";
import { fightCandidates, pickFightTarget } from "./fightSense.js";
import { initNavigation } from "./navMesh.js";
import { withPerceptionDelay } from "./perceptionDelay.js";
import { botProfile, type BotProfile } from "./profile.js";
import { botRandom } from "./random.js";
import { TreeBot } from "./TreeBot.js";

/**
 * M17 ticket 09: the Fight, one question per test, on a small flat Track —
 * one 18 m deck over the void, no Checkpoint and no Finish Zone, so the
 * Race goal has nowhere to run and whatever a Bot does is its Fight.
 */

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
const RULES = resolveRoundRules({ timeLimitMs: 300_000, fallBehavior: "respawn", survivorTarget: 1 });

const TOP = 4;
/** The deck spans x −9..9 and z −18..0. */
const deck = (extra: Extra = {}) => onTop("kaykit_platform_6x6x1_blue", 0, TOP, 9, { scale: 3, ...extra });
const stand = (x: number, z: number): Vec3 => ({ x, y: TOP + 1, z });

let library: Record<string, Module>;
const tracks: BotTrack[] = [];
let flat: BotTrack;

beforeAll(async () => {
  await Promise.all([initPhysics(), initNavigation()]);
  library = await loadAssetLibrary(
    async (url) => new Uint8Array(readFileSync(join(assetsRoot, url.substring(url.lastIndexOf("/") + 1)))),
    "http://assets.test",
  );
  flat = botTrackOf([deck()]);
});
afterAll(() => tracks.forEach(disposeBotTrack));

const botTrackOf = (track: Track): BotTrack => {
  const built = buildBotTrack(resolveTrack(library, track));
  tracks.push(built);
  return built;
};

/** A Bot that always takes its chance, and aims and reacts perfectly: what a test wants to watch. */
const keen = (seed: string, overrides: Partial<BotProfile> = {}): BotProfile => ({
  ...botProfile("normal", seed),
  reactionTicks: 0,
  clumsiness: 0,
  aimError: 0,
  aggression: 1,
  chanceTaking: 1,
  ...overrides,
});

const viewOf = (state: SimState, id: string, track: BotTrack): BotWorldView => ({
  tick: state.tick + 1,
  id,
  self: state.characters[id]!,
  characters: state.characters,
  props: state.props,
  bombs: state.bombs ?? [],
  track,
  rules: RULES,
});

interface World {
  sim: RapierSimulation;
  /** Every Tick's state, after it. */
  states: SimState[];
}

/**
 * Runs `bots` as the Match loop does (each reads the state after the last
 * Tick), everyone else by `script`, for `ticks`, stopping early once `until`
 * holds.
 */
const run = (
  track: BotTrack,
  at: Record<string, Vec3>,
  bots: Record<string, Bot>,
  ticks: number,
  { script = () => ({}), until }: { script?: (n: number, state: SimState) => Record<string, SimInputs>; until?: (state: SimState) => boolean } = {},
): World => {
  const sim = new RapierSimulation({ ...track.resolved, withDefaultCharacter: false });
  for (const [id, point] of Object.entries(at)) sim.addCharacter(id, point);
  const states: SimState[] = [];
  for (let n = 0; n < ticks; n += 1) {
    const state = sim.snapshot();
    if (until?.(state)) break;
    const inputs: Record<string, SimInputs> = { ...script(n, state) };
    for (const [id, bot] of Object.entries(bots)) inputs[id] = bot.think(viewOf(state, id, track));
    sim.tick(inputs, "RUNNING");
    states.push(sim.snapshot());
  }
  return { sim, states };
};

const everyTick = (world: World, id: string): CharacterSnapshot[] => world.states.map((s) => s.characters[id]!);

describe("who a Bot fights (M17 ticket 09, ADR 0129)", () => {
  const selfAt = stand(0, -3);
  const character = (position: Vec3): CharacterSnapshot => {
    const sim = new RapierSimulation({ ...flat.resolved, withDefaultCharacter: false });
    sim.addCharacter("c", position);
    // Settled on the deck: standing, grounded.
    for (let n = 0; n < 15; n += 1) sim.tick({}, "RUNNING");
    const snapshot = { ...sim.snapshot().characters.c!, position };
    sim.dispose();
    return snapshot;
  };
  const view = (characters: Record<string, CharacterSnapshot>): BotWorldView => ({
    tick: 1,
    id: "me",
    self: characters.me!,
    characters,
    track: flat,
    rules: RULES,
  });
  const NORTH = { x: 0, y: 0, z: -1 };

  it("takes a human and a Bot standing in the same spot equally often: nothing but exposure and distance is read", () => {
    const spot = character(stand(0.5, -6));
    const characters = { me: character(selfAt), human: spot, "bot-7": { ...spot } };
    const picked = { human: 0, "bot-7": 0 };
    const draws = 400;
    for (let n = 0; n < draws; n += 1) {
      const target = pickFightTarget(fightCandidates(view(characters), NORTH, "strike"), botRandom(`fairness ${n}`));
      picked[target!.id as keyof typeof picked] += 1;
    }
    expect(picked.human + picked["bot-7"]).toBe(draws);
    expect(picked.human / draws).toBeGreaterThan(0.4);
    expect(picked.human / draws).toBeLessThan(0.6);
  });

  it("chooses by where they stand, whoever stands there: swapping two Characters swaps the choice", () => {
    const near = character(stand(0, -5));
    const far = character(stand(1, -8));
    const a = pickFightTarget(fightCandidates(view({ me: character(selfAt), human: near, "bot-2": far }), NORTH, "strike"), botRandom("swap"));
    const b = pickFightTarget(fightCandidates(view({ me: character(selfAt), human: far, "bot-2": near }), NORTH, "strike"), botRandom("swap"));
    expect(a!.id).toBe("human");
    expect(b!.id).toBe("bot-2");
  });

  it("prefers the one with a void at its back to one as near in the middle of the deck", () => {
    // Both 3 m away; one has the deck's west edge 1.5 m behind it, the other open deck.
    const me = character(stand(-4.5, -9));
    const exposed = character(stand(-7.5, -9));
    const safe = character(stand(-4.5, -12));
    const candidates = fightCandidates(view({ me, exposed, safe }), { x: -0.7071, y: 0, z: -0.7071 }, "strike");
    const byId = Object.fromEntries(candidates.map((c) => [c.id, c]));
    expect(byId.exposed!.exposure).toBeGreaterThan(0);
    expect(byId.safe!.exposure).toBe(0);
    expect(pickFightTarget(candidates, botRandom("edge"))!.id).toBe("exposed");
  });

  it("never picks someone past the deck's edge: a chase leaves the navmesh never", () => {
    const me = character(stand(-6, -9));
    const offDeck = { ...character(stand(-6, -9)), position: stand(-11, -9) };
    expect(fightCandidates(view({ me, offDeck }), { x: -1, y: 0, z: 0 }, "catch")).toHaveLength(0);
  });

  it("fights less when far behind the leader: its aggression is scaled down, never its choice", () => {
    const decisions = (behind: boolean): number => {
      const me = { ...character(selfAt), checkpointIndex: behind ? 0 : BOT_BEHIND_CHECKPOINTS };
      const leader = { ...character(stand(4, -2)), checkpointIndex: BOT_BEHIND_CHECKPOINTS };
      const target = character(stand(0, -5));
      let fights = 0;
      for (let n = 0; n < 60; n += 1) {
        const fighter = new Fighter(`behind ${n}`, keen(`behind ${n}`, { aggression: 0.8 }));
        if (fighter.think({ ...view({ me, leader, target }), tick: 100 }, 0) !== null) fights += 1;
      }
      return fights;
    };
    expect(decisions(true)).toBeLessThan(decisions(false));
  });
});

describe("a Bot fights (M17 ticket 09): real Characters, real simulation", () => {
  it("charges a Hit while it closes, and lets it go in reach charged enough to knock down", () => {
    const bot = new TreeBot({ seed: "hit", profile: keen("hit") });
    const world = run(flat, { bot: stand(0, -3), target: stand(0, -7) }, { bot }, 150, {
      until: (s) => s.characters.target!.motionState === "Ragdoll",
    });
    const target = world.sim.snapshot().characters.target!;
    expect(target.motionState).toBe("Ragdoll");
    expect(target.ragdollCause).toBe("Hit");
    expect(bot.fightTally.strikes).toBe(1);
    expect(everyTick(world, "bot").every((c) => c.fallCount === 0)).toBe(true);
    world.sim.dispose();
  });

  it("catches someone near an edge, Spins, and Hurls them off it, never going near the edge itself", () => {
    const bot = new TreeBot({ seed: "hurl", profile: keen("hurl") });
    // The deck's west edge is at x = −9: the target 2 m from it, the Bot 3.5 m.
    const world = run(flat, { bot: stand(-5.5, -9), target: stand(-7, -9) }, { bot }, 240, {
      until: (s) => s.characters.target!.fallCount > 0,
    });
    const end = world.sim.snapshot().characters;
    expect(end.target!.fallCount).toBe(1);
    expect(bot.fightTally.catches).toBe(1);
    expect(bot.fightTally.hurls).toBe(1);
    const botTicks = everyTick(world, "bot");
    expect(botTicks.every((c) => c.fallCount === 0)).toBe(true);
    // Never within its own margin of the edge, whatever it did.
    expect(Math.min(...botTicks.map((c) => c.position.x + 9))).toBeGreaterThan(2);
    world.sim.dispose();
  });

  it("with no edge in reach, lets go of whoever it caught and runs on", () => {
    // On a Track with a deck so big no edge is within its search.
    const big = botTrackOf([onTop("kaykit_platform_6x6x1_blue", 0, TOP, 30, { scale: 10 })]);
    // Nobody is exposed on open deck, so a Grab is never chosen there: the catch is made by hand.
    const fighter = new Fighter("drop", keen("drop"));
    const sim = new RapierSimulation({ ...big.resolved, withDefaultCharacter: false });
    sim.addCharacter("bot", stand(0, -30));
    sim.addCharacter("target", stand(0, -31.3));
    // The Bot's own reach, by hand, then the Fighter takes over the hold.
    sim.tick({ bot: { ...IDLE_INPUTS, grabHeld: true } }, "RUNNING");
    sim.tick({}, "RUNNING");
    expect(sim.snapshot().characters.bot!.grabbingId).toBe("target");
    let dropped = false;
    for (let n = 0; n < 60 && !dropped; n += 1) {
      const state = sim.snapshot();
      const order = fighter.think(viewOf(state, "bot", big), 0);
      if (order?.grabHeld && state.characters.bot!.grabbingId !== null) dropped = true;
      sim.tick({ bot: { ...IDLE_INPUTS, moveDirection: order?.moveDirection ?? IDLE_INPUTS.moveDirection, hitHeld: order?.hitHeld ?? false, grabHeld: order?.grabHeld ?? false } }, "RUNNING");
    }
    sim.tick({}, "RUNNING");
    expect(dropped).toBe(true);
    expect(fighter.tally.drops).toBe(1);
    expect(fighter.tally.hurls).toBe(0);
    expect(sim.snapshot().characters.bot!.grabbingId).toBeNull();
    sim.dispose();
  });

  it("Struggles when Held, wiggling hard enough to break free inside the window", () => {
    const bot = new TreeBot({ seed: "struggle", profile: keen("struggle") });
    const world = run(flat, { bot: stand(0, -9), grabber: stand(0, -7.8) }, { bot }, GRAB_STRUGGLE_WINDOW_TICKS + 10, {
      // The grabber faces the Bot (north, facing 0) and reaches once.
      script: (n) => ({ grabber: { ...IDLE_INPUTS, grabHeld: n === 0 } }),
    });
    const held = everyTick(world, "bot");
    const heldTicks = held.filter((c) => c.motionState === "Held");
    expect(heldTicks.length).toBeGreaterThan(0);
    expect(Math.max(...held.map((c) => c.escapeProgress))).toBeGreaterThan(0.5);
    // Broke free: standing again, never Limp.
    expect(held.some((c) => c.heldPhase === "limp")).toBe(false);
    expect(held.at(-1)!.motionState).not.toBe("Held");
    world.sim.dispose();
  });

  it("Lifts a Prop lying in its way when there is someone to throw it at, and Tosses it at them", () => {
    const track = botTrackOf([deck(), at("kaykit_cone_yellow", 0, TOP, 5, { prop: true })]);
    const bot = new TreeBot({ seed: "toss", profile: keen("toss") });
    const world = run(track, { bot: stand(0, -3), target: stand(0, -8.5) }, { bot }, 150);
    const carried = world.states.findIndex((s) => s.props[0]!.carriedBy === "bot");
    expect(carried).toBeGreaterThan(-1);
    const released = world.states.findIndex((s, n) => n > carried && s.props[0]!.carriedBy === undefined);
    expect(released).toBeGreaterThan(carried);
    // Then, lying ahead again with the target still there, it may well be picked up again.
    expect(bot.fightTally.lifts).toBeGreaterThanOrEqual(1);
    expect(bot.fightTally.tosses).toBeGreaterThanOrEqual(1);
    // Thrown toward the target, well past where it was picked up.
    expect(Math.min(...world.states.slice(released, released + 30).map((s) => s.props[0]!.position.z))).toBeLessThan(-6.5);
    world.sim.dispose();
  });

  it("picks a Bomb up only with a group to throw it at, and has thrown it before it goes off", () => {
    const track = botTrackOf([deck(), at("bomb_A", 0, TOP, 5)]);
    expect(track.resolved.props[0]?.bomb).toBeDefined();
    const bot = new TreeBot({ seed: "bomb", profile: keen("bomb") });
    const world = run(track, { bot: stand(0, -3), a: stand(-0.8, -10.5), b: stand(0.8, -11) }, { bot }, 300);
    const lit = world.states.find((s) => s.bombs?.[0]?.detonateTick !== undefined);
    expect(lit).toBeDefined();
    const detonateTick = lit!.bombs![0]!.detonateTick!;
    const atBlast = world.states.find((s) => s.tick === detonateTick - 1);
    expect(atBlast?.props[0]!.carriedBy).toBeUndefined();
    expect(bot.fightTally.bombThrows).toBe(1);
    world.sim.dispose();
  });

  it("leaves a Bomb lying when there is no group to throw it at", () => {
    const track = botTrackOf([deck(), at("bomb_A", 0, TOP, 5)]);
    const bot = new TreeBot({ seed: "no group", profile: keen("no group") });
    const world = run(track, { bot: stand(0, -3), lone: stand(0, -10) }, { bot }, 120);
    expect(world.states.every((s) => s.props[0]!.carriedBy === undefined)).toBe(true);
    expect(bot.fightTally.lifts).toBe(0);
    world.sim.dispose();
  });
});

describe("a Shooter's Bomb, caught (M17 ticket 09, ADR 0127)", () => {
  /** The flat deck's world with one more Prop: a Shooter's Bomb flying at the Bot from the north. */
  const incoming = (profile: BotProfile) => {
    const sim = new RapierSimulation({ ...flat.resolved, withDefaultCharacter: false });
    sim.addCharacter("me", stand(0, -3));
    const state = sim.snapshot();
    sim.dispose();
    const track: BotTrack = {
      ...flat,
      resolved: {
        ...flat.resolved,
        props: [{ shape: { kind: "ball", radius: 0.4 }, center: stand(0, -5), mass: 3, projectile: true, bomb: { fuseSeconds: 3, warnSeconds: 1, returnSeconds: 8 } }],
      },
    };
    const fighter = new Fighter("catch", profile);
    const orders = [];
    // It flies in at 20 u/s from 6 m out, a Tick at a time.
    for (let n = 0; n < 10; n += 1) {
      const z = -9 + (20 / 30) * n;
      const view: BotWorldView = {
        ...viewOf(state, "me", track),
        tick: 100 + n,
        props: [{ position: { x: 0, y: TOP + 1, z }, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 0, y: 0, z: 20 }, atRest: false, live: true }],
        bombs: [{ propIndex: 0, detonateTick: 190 }],
      };
      orders.push(fighter.think(view, 0));
    }
    return { fighter, orders };
  };

  it("is reached for at HARD, facing it as it comes", () => {
    const { fighter, orders } = incoming(keen("hard catch", { reactionTicks: 0 }));
    expect(orders.some((o) => o?.grabHeld === true)).toBe(true);
    expect(fighter.tally.bombCatches).toBe(1);
  });

  it("is let fly by at NORMAL: catching one needs HARD's reflexes", () => {
    const normal = botProfile("normal", "normal catch");
    const { fighter, orders } = incoming({ ...normal, chanceTaking: 1 });
    expect(orders.some((o) => o?.grabHeld === true)).toBe(false);
    expect(fighter.tally.bombCatches).toBe(0);
  });
});

describe("the fight's perception delay (M17 ticket 09, ADR 0129)", () => {
  it("delays Props and Bombs exactly as it delays the Characters", () => {
    const seen: BotWorldView[] = [];
    const inner: Bot = {
      think: (view) => {
        seen.push(view);
        return IDLE_INPUTS;
      },
    };
    const profile = { ...botProfile("normal", "delay"), reactionTicks: 3, clumsiness: 0 };
    const delayed = withPerceptionDelay(inner, profile, "delay");
    const sim = new RapierSimulation({ ...flat.resolved, withDefaultCharacter: false });
    sim.addCharacter("me", stand(0, -3));
    const base = viewOf(sim.snapshot(), "me", flat);
    sim.dispose();
    for (let n = 0; n < 8; n += 1) {
      delayed.think({ ...base, tick: n, characters: { ...base.characters }, props: [], bombs: [{ propIndex: n, detonateTick: n + 100 }] });
    }
    const last = seen.at(-1)!;
    expect(last.tick).toBe(7);
    expect(last.bombs![0]!.propIndex).toBe(4);
  });
});
