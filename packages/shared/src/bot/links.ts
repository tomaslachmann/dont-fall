import { vec3, type Vec3 } from "../math/vec3.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import { BOT_BRAKE_MIN_SPEED, BOT_LINK_AIM_AHEAD_M, BOT_LINK_LAND_TICKS, BOT_LINK_MAX_TICKS, BOT_LINK_RUN_TICKS } from "../tuning/bots.js";
import { JUMP_HOLD_MAX_TICKS } from "../tuning/movement.js";

/**
 * What joins two places the navmesh does not (M17 ticket 05, ADR 0129):
 *
 * - `jump`: across a gap, up or down a tier;
 * - `bounce`: the same, taken off a bounce deck, whose jump is bigger;
 * - `updraft`: a jump into an updraft Volume, which carries it;
 * - `launch`: onto a Spring or a launch pad, which throws it;
 * - `slide`: off an edge and down a Sliding ramp (ADR 0037), which the
 *   navmesh leaves off because nobody walks it.
 *
 * The kind names what a link is for, in the builder and the suites. It never
 * changes how a link is followed: that is the recipe alone.
 */
export type NavLinkKind = "jump" | "bounce" | "updraft" | "launch" | "slide";

/**
 * The input that proved a link, and that a Bot follows it with (M17 ticket
 * 05). It is a recipe rather than a list of inputs so the Bot can start it
 * from where it actually stands, and the proof plays it from beside the start
 * as well as on it ({@link LinkRun}).
 */
export interface LinkRecipe {
  /** Where the run-up starts: a point on the navmesh, on the floor. */
  readonly from: Vec3;
  /** The run-up's direction, a unit vector on the ground. The run is steered along the line through {@link from}. */
  readonly direction: Vec3;
  /**
   * How far along the line from {@link from} jump is pressed, in metres, or
   * `null` when the link is taken without a jump: walked onto a Spring, or
   * off the top of a Sliding ramp.
   */
  readonly jumpAt: number | null;
  /** Whether the direction is still pushed once in the air. A Spring's throw can land further without it. */
  readonly steerInAir: boolean;
  /**
   * Whether the Dash is pressed. Always `false` today: a link a Bot could take
   * only with its Dash ready would strand every Bot whose Dash was spent
   * (ADR 0092: 15 s to recharge), so none is proven with one (open question,
   * ticket 05).
   */
  readonly dash: false;
}

/** One Tick of a link as it was proven: the move and whether jump was held. */
export interface LinkScriptStep {
  readonly x: number;
  readonly z: number;
  readonly jump: boolean;
}

/** A proven link (M17 ticket 05): where it starts, where it landed when proven, and how. */
export interface NavLink extends LinkRecipe {
  readonly kind: NavLinkKind;
  /** Where the proof landed and settled, on the navmesh, on the floor. */
  readonly to: Vec3;
  /**
   * Every input the proof sent, Tick by Tick, from a stand on {@link from}
   * until it had landed and stood (M17 ticket 06). A Bot plays exactly this
   * from a stand ({@link LinkReplay}), and the proof played it again from
   * beside the start and a little either way along it, where a Bot may be
   * standing when it begins.
   */
  readonly script: readonly LinkScriptStep[];
  /**
   * For a link that starts on a bounce deck (M17 ticket 06b): which Ticks of
   * the deck's hop the script was proven from. Absent on every other link.
   */
  readonly hop?: LinkHop;
}

/**
 * One Tick of the hop a bounce deck keeps a capsule standing on it in (ADR
 * 0094: every landing gives back at least the deck's `minSpeed`, so it never
 * stops): whether its feet are down, its vertical speed, and how high its
 * feet are over where they stand when down. Measured, never worked out.
 */
export interface HopState {
  readonly grounded: boolean;
  readonly vy: number;
  readonly dy: number;
}

/**
 * Which phases of a bounce deck's hop a link's script lands from (M17 ticket
 * 06b). A capsule on a bounce deck is always somewhere in its hop, and a jump
 * pressed there only counts within a few Ticks of a landing, so the proof
 * plays the script from every phase: `safe[k]` is whether it landed, from
 * the start and from beside it, started when the capsule's latest Snapshot
 * was at phase `k` of `cycle`. All of them safe, the link needs no timing.
 */
export interface LinkHop {
  /** The settled hop, a Tick an entry: phase 0 is the first Tick its feet are down. */
  readonly cycle: readonly HopState[];
  readonly safe: readonly boolean[];
}

/** How near a seen state must be to one of {@link LinkHop.cycle}'s to be read as it: well under a Tick's change of either. */
const HOP_VY_TOLERANCE = 0.1;
const HOP_DY_TOLERANCE = 0.03;

/**
 * Where in its hop a Bot sees itself (M17 ticket 06b), read only off what it
 * sees: its own Character's feet, vertical speed and height over the floor
 * its feet were last seen down on. A state that is no phase of the settled
 * hop (a bigger hop still dying away after a landing, a push, another floor)
 * reads as `null`, and so does every state until a whole hop in a row has
 * read as one: a Bot only times a take-off off a hop it has seen settle.
 */
export class HopReader {
  private floorY: number | null = null;
  private run = 0;

  /** The phase of `self`, a state as the Bot sees it this Tick, or `null` (see the class). */
  read(cycle: readonly HopState[], self: Readonly<CharacterSnapshot>): number | null {
    const y = self.position.y;
    if (self.grounded) this.floorY = y;
    let phase: number | null = null;
    if (this.floorY !== null) {
      const dy = y - this.floorY;
      for (let k = 0; k < cycle.length; k += 1) {
        const state = cycle[k]!;
        if (state.grounded !== self.grounded) continue;
        if (Math.abs(state.vy - self.velocity.y) > HOP_VY_TOLERANCE || Math.abs(state.dy - dy) > HOP_DY_TOLERANCE) continue;
        phase = k;
        break;
      }
    }
    this.run = phase === null ? 0 : this.run + 1;
    return this.run > cycle.length ? phase : null;
  }

  /** Forgets what it saw: the Bot has moved on to another start. */
  reset(): void {
    this.floorY = null;
    this.run = 0;
  }
}

/**
 * Whether a link's hop can be started now (M17 ticket 06b): every phase the
 * Bot may really be at is a safe one. `seen` is the phase it sees itself at,
 * and its view is between `min` and `max` Ticks old. A link safe from every
 * phase needs no phase seen.
 */
export const hopStartable = (hop: LinkHop, seen: number | null, min: number, max: number): boolean => {
  if (hop.safe.every(Boolean)) return true;
  if (seen === null) return false;
  for (let late = min; late <= max; late += 1) if (!hop.safe[(seen + late) % hop.safe.length]) return false;
  return true;
};

/** The most phases in a row, round the hop, a {@link LinkHop.safe} holds: the widest spread of lateness a Bot can time it with. */
export const hopSafeRun = (safe: readonly boolean[]): number => {
  if (safe.every(Boolean)) return safe.length;
  let best = 0;
  let run = 0;
  for (let i = 0; i < safe.length * 2; i += 1) {
    run = safe[i % safe.length] ? run + 1 : 0;
    best = Math.max(best, Math.min(run, safe.length));
  }
  return best;
};

/** A link's input for one Tick. */
export interface LinkStep {
  readonly moveDirection: Vec3;
  readonly jump: boolean;
  /** The link has landed and settled: the Bot plans again from where it stands. */
  readonly done: boolean;
  /** The link took longer than it may (its run-up {@link BOT_LINK_RUN_TICKS}, all of it {@link BOT_LINK_MAX_TICKS}): the Bot gives up on it and plans again. */
  readonly failed: boolean;
}

type Phase = "run" | "air" | "land";

const STILL = vec3();

/**
 * Following one link, Tick by Tick: the one controller both the proof and
 * the Bot run, so a Bot takes a link with exactly the input that proved it
 * (M17 ticket 05).
 *
 * 1. **Run.** Along the line through the recipe's `from`, aimed
 *    {@link BOT_LINK_AIM_AHEAD_M} ahead on it, so a Bot that arrived a little
 *    to one side runs back onto it. Jump is pressed once the capsule is
 *    `jumpAt` along, and held for the whole of the jump's boost
 *    ({@link JUMP_HOLD_MAX_TICKS}), as a Player holds it to jump far.
 * 2. **Air.** Off the ground (or Sliding), or for a link taken without a jump
 *    off the navmesh (down a ramp): the direction is pushed on, or let go, as
 *    the recipe says.
 * 3. **Land.** Back on the ground, in control and over the navmesh: let go, which stops a
 *    capsule on a floor with grip at once, and on ice push against the
 *    slide until it is slow. The link is done.
 */
export class LinkRun {
  private phase: Phase = "run";
  private ticks = 0;
  private landedTicks = 0;
  private jumpTicks = 0;
  private pressed = false;

  constructor(readonly link: LinkRecipe) {}

  /**
   * The input for this Tick. `onNavmesh` is whether the capsule stands over
   * the navmesh (`navStandsOn`): a link has landed only where it has, and one
   * taken without a jump is under way once the capsule has left it (off the
   * top of a ramp) as much as when it is in the air.
   */
  step(self: Readonly<CharacterSnapshot>, onNavmesh: boolean): LinkStep {
    this.ticks += 1;
    const { from, direction, jumpAt, steerInAir } = this.link;
    const airborne = !self.grounded || self.motionState === "Sliding";
    if (this.phase === "run" && (jumpAt === null ? airborne || !onNavmesh : this.pressed && airborne)) this.phase = "air";
    // Still on the run-up long after it should have left the ground: something is in the way.
    const late = this.phase === "run" && this.ticks > BOT_LINK_RUN_TICKS;
    if (late || this.ticks > BOT_LINK_MAX_TICKS) return { moveDirection: STILL, jump: false, done: false, failed: true };
    if (this.phase === "air" && !airborne && onNavmesh && this.jumpTicks === 0) this.phase = "land";

    if (this.phase === "land") {
      this.landedTicks += 1;
      const speed = Math.hypot(self.velocity.x, self.velocity.z);
      if (speed < BOT_BRAKE_MIN_SPEED || this.landedTicks > BOT_LINK_LAND_TICKS) {
        return { moveDirection: STILL, jump: false, done: true, failed: false };
      }
      // Letting go stops a capsule dead on a floor with grip; only one still
      // sliding a Tick later (ice) is pushed against. Pushed against on grip,
      // it would run backwards at full speed, and the next Tick forwards.
      if (this.landedTicks === 1) return { moveDirection: STILL, jump: false, done: false, failed: false };
      return { moveDirection: vec3(-self.velocity.x / speed, 0, -self.velocity.z / speed), jump: false, done: false, failed: false };
    }

    let jump = false;
    if (this.jumpTicks > 0) {
      this.jumpTicks -= 1;
      jump = true;
    } else if (this.phase === "run" && jumpAt !== null && !this.pressed && !airborne) {
      const along = (self.position.x - from.x) * direction.x + (self.position.z - from.z) * direction.z;
      if (along >= jumpAt) {
        this.pressed = true;
        this.jumpTicks = JUMP_HOLD_MAX_TICKS;
        jump = true;
      }
    }

    if (this.phase === "air") return { moveDirection: steerInAir ? direction : STILL, jump, done: false, failed: false };
    // On the line, a little ahead of the capsule's own spot on it.
    const along = Math.max(0, (self.position.x - from.x) * direction.x + (self.position.z - from.z) * direction.z) + BOT_LINK_AIM_AHEAD_M;
    const dx = from.x + direction.x * along - self.position.x;
    const dz = from.z + direction.z * along - self.position.z;
    const length = Math.hypot(dx, dz);
    return { moveDirection: length === 0 ? direction : vec3(dx / length, 0, dz / length), jump, done: false, failed: false };
  }
}

/**
 * A proven link played as a Bot takes it (M17 ticket 06): its
 * {@link NavLink.script}, one step a Tick, from a stand, with nothing read
 * back. {@link LinkRun} steers by where the capsule is; a Bot sees where it
 * was a few Ticks ago (ticket 08's reaction time), so steered like that it
 * pressed jump past the edge. From a stand the Bot's view is where it is
 * (`EdgeGuard.fresh`), and from there the script is what proved the link:
 * a jump is a move the Bot commits to and plays by its own count.
 */
export class LinkReplay {
  private tick = 0;

  constructor(readonly link: NavLink) {}

  /** This Tick's input, or `null` once the script is played out. */
  step(): { moveDirection: Vec3; jump: boolean } | null {
    const step = this.link.script[this.tick];
    if (step === undefined) return null;
    this.tick += 1;
    return { moveDirection: vec3(step.x, 0, step.z), jump: step.jump };
  }
}
