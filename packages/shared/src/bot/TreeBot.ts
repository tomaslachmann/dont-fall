import { BehaviourTree, State } from "mistreevous";
import { facingFromModelYaw, modelYawFromFacing, nextModelYaw } from "../input/bodyFacing.js";
import { isDownMotionState, isPlayerDrivenMotionState } from "../simulation/CharacterStateMachine.js";
import { propCarryTurn } from "../simulation/propCarry.js";
import { IDLE_INPUTS, type SimInputs } from "../simulation/SimInputs.js";
import type { Vec3 } from "../math/vec3.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import { TICK_DT, TICK_RATE_HZ } from "../tuning/clock.js";
import { GRAB_TURN_SPEED_MULTIPLIER } from "../tuning/fight.js";
import type { Bot, BotWorldView } from "./Bot.js";
import { EdgeGuard, staleWindow } from "./edgeGuard.js";
import { Fighter, type FightOrder, type FightTally } from "./fight.js";
import { defaultHooks } from "./hooks.js";
import { PathFollower, type Route, type Steering } from "./PathBot.js";
import { botProfile, type BotProfile } from "./profile.js";
import { RACE_GOAL } from "./raceGoal.js";
import { botRandom } from "./random.js";

/**
 * What a Round goal's leaves are given (M17 ticket 04): the Tick's view, the
 * Bot's seed for its standing preferences, and the one way a goal acts, a
 * {@link Route} to run.
 */
export interface BotContext {
  readonly view: BotWorldView;
  readonly seed: string;
  /**
   * How many times this Bot has come back into control (got up, been let go,
   * respawned). A goal puts it in its {@link Route.key}, so a Bot that was
   * knocked about plans its run afresh from where it landed.
   */
  readonly recoveries: number;
  /**
   * This Bot's spread (M17 ticket 08). `reactionTicks`/`clumsiness` are
   * applied outside, by `withPerceptionDelay`, never read here; the rest
   * wait on the leaves ticket 07 and 09 add.
   */
  readonly profile: BotProfile;
  /** Run `route` this Tick: the path-following leaf. */
  run(route: Route): void;
}

/** A leaf of a goal's tree: a condition answers true or false, an action says how it went. */
export type GoalLeaf = (bot: BotContext) => boolean | State;

/**
 * What a Round is about, for a Bot (ADR 0129): the one slot of the tree that
 * differs between Round types. Ticket 04's is the Race; ticket 12 adds
 * Survival as another value here, never a branch on the mode (ADR 0043).
 */
export interface BotGoal {
  /** The goal's subtree, in `mistreevous` MDSL, named `Goal`: `root [Goal] { … }`. */
  readonly tree: string;
  /** Every leaf the subtree names, by name. */
  readonly leaves: Readonly<Record<string, GoalLeaf>>;
}

/**
 * Every Bot's tree (M17 ticket 04, ADR 0129), stepped once a Tick. Its shape
 * is the same for every Round type, in priority order:
 *
 * 1. **Recover.** Down (Ragdoll, getting up), Held, or between a Fall and its
 *    Respawn: the Character is not the Bot's to drive, so it stands and waits
 *    — or, Held and still in its Struggle, wiggles A/D to break free (M17
 *    ticket 09, ADR 0104).
 * 2. **Fight** (M17 ticket 09, {@link Fighter}): a Hit, a Grab with its Spin
 *    and Hurl, a Prop's Lift and Toss, a Bomb — taken as chances come, as
 *    often as the Bot's `aggression` has it, and finished once started.
 * 3. **Goal.** The Round's own ({@link BotGoal}): the Race here.
 *
 * Every leaf finishes within its Tick, so the tree ends each step and the
 * next begins at the root: Recover is asked first every Tick, and nothing a
 * goal was doing survives a knockdown. What has to span Ticks (ticket 09's
 * Grab, Spin and Hurl) is the {@link Fighter}'s plan, kept between steps and
 * asked again each Tick by `SeesAFight`, so a knockdown still ends it.
 */
const TREE = `
root {
  selector {
    branch [Recover]
    branch [Fight]
    branch [Goal]
  }
}
root [Recover] {
  sequence {
    condition [IsOutOfControl]
    selector {
      sequence {
        condition [IsStruggling]
        action [Struggle]
      }
      action [WaitUntilBackInControl]
    }
  }
}
root [Fight] {
  sequence {
    condition [SeesAFight]
    action [Fight]
  }
}
`;

export interface TreeBotOptions {
  /**
   * Everything random about this Bot comes from here (ADR 0129), including
   * its {@link BotProfile} when none is given. `BotDriver.add` seeds it with
   * the Match and the seat (M17 ticket 08), so a suite's Bots play the same
   * every run and a live Lobby's do not repeat.
   */
  seed: string;
  /** The Round's goal. The Race's, until ticket 12 adds another. */
  goal?: BotGoal;
  /**
   * This Bot's spread (M17 ticket 08, ADR 0129). Defaults to NORMAL's spread
   * on this Bot's own seed, so a `TreeBot` built directly — every test before
   * this ticket, and one built with no host setting to read — still behaves
   * the same. Reaction time and clumsiness are applied outside this class,
   * by `withPerceptionDelay` wrapping it with the same profile, as
   * `BotDriver.add` does; given here, the Bot also knows how late it sees
   * itself (`EdgeGuard`, M17 ticket 06). Built with none, it is not wrapped
   * and sees itself as it is.
   */
  profile?: BotProfile;
}

/**
 * The Bot (CONTEXT.md, ADR 0129): a `mistreevous` behaviour tree over a
 * {@link PathFollower}, turning a view of the world into one input a Tick.
 *
 * The tree is given the Bot's seeded `random` and a Tick-long `getDeltaTime`
 * (M17 ticket 01): without them `mistreevous` reads `Math.random()` and the
 * wall clock, and a Bot would stop playing the same every run.
 *
 * Its `facing` is the body a Player's client would send (ADR 0085): turned
 * toward where it runs by the client's own rule, one Tick at a time. While the
 * simulation turns the body instead (down, Held), the Bot takes the body's
 * facing back, so it turns on from where the body is when it is its own again.
 *
 * Its {@link BotProfile} rides along in the {@link BotContext}, for the goal
 * leaves ticket 07 and 09 add. Difficulty itself (M17 ticket 08) is not this
 * class's to apply beyond that: `BotDriver.add` wraps a `TreeBot` in
 * `withPerceptionDelay` for `reactionTicks`/`clumsiness`, outside it.
 */
export class TreeBot implements Bot {
  private readonly tree: BehaviourTree;
  /** What keeps every move this Bot sends on something to stand on (M17 ticket 06). */
  private readonly guard: EdgeGuard;
  private readonly follower: PathFollower;
  private view: BotWorldView | null = null;
  private steering: Steering = { moveDirection: IDLE_INPUTS.moveDirection, dash: false };
  /** The body's yaw in the model's convention, as the client keeps it. */
  private bodyYaw: number | null = null;
  /** Falls already answered by a Respawn, so one not yet answered is a Respawn on its way. */
  private fallsRespawned: number | null = null;
  private respawnsSeen: number | null = null;
  private wasOutOfControl = false;
  private recoveries = 0;
  /** The Fight's plan and its counts (M17 ticket 09). */
  private readonly fighter: Fighter;
  /** What the Fight asked for this Tick, when it did. */
  private fightOrder: FightOrder | null = null;
  /** The buttons this Tick: only the Fight ever holds them. */
  private buttons = { hitHeld: false, grabHeld: false };
  /** Turn the body toward this instead of along the walk (the Fight turning to a target while it stands). */
  private face: FightOrder["face"] = null;
  /** Whether the Fight drove this Tick's input: what a suite reads to tell a Fall the Fight walked into. */
  private fought = false;

  constructor({ seed, goal = RACE_GOAL, profile: given }: TreeBotOptions) {
    const profile = given ?? botProfile("normal", seed);
    this.guard = new EdgeGuard(given === undefined ? { min: 0, max: 0 } : staleWindow(given));
    this.follower = new PathFollower(this.guard, defaultHooks(profile, seed), profile, seed);
    this.fighter = new Fighter(seed, profile);
    // The context's getters read this Bot's live state; a getter's own `this` is the context.
    const bot = this;
    const context: BotContext = {
      get view() {
        return bot.currentView();
      },
      seed,
      get recoveries() {
        return bot.recoveries;
      },
      profile,
      run: (route) => {
        const view = this.currentView();
        const others: Vec3[] = [];
        for (const [id, other] of Object.entries(view.characters)) if (id !== view.id && !other.eliminated) others.push(other.position);
        this.steering = this.follower.follow(view, route, others);
      },
    };
    const agent: Record<string, () => boolean | State> = {
      IsOutOfControl: () => this.outOfControl(this.currentView().self),
      WaitUntilBackInControl: () => {
        this.wasOutOfControl = true;
        this.fighter.reset();
        return State.SUCCEEDED;
      },
      // ADR 0104: a Held Character's input does one thing, the Struggle; Limp, it does nothing.
      IsStruggling: () => {
        const { self } = this.currentView();
        return self.motionState === "Held" && self.heldPhase === "struggle";
      },
      Struggle: () => {
        this.wasOutOfControl = true;
        this.fighter.reset();
        this.steering = { moveDirection: this.fighter.struggle(), dash: false };
        return State.SUCCEEDED;
      },
      SeesAFight: () => {
        const view = this.currentView();
        this.fightOrder = this.fighter.think(view, facingFromModelYaw(this.bodyYaw ?? modelYawFromFacing(view.self.facing)));
        return this.fightOrder !== null;
      },
      Fight: () => {
        const order = this.fightOrder!;
        this.steering = { moveDirection: order.moveDirection, dash: false };
        this.buttons = { hitHeld: order.hitHeld, grabHeld: order.grabHeld };
        this.face = order.face;
        this.fought = true;
        return State.SUCCEEDED;
      },
    };
    for (const [name, leaf] of Object.entries(goal.leaves)) agent[name] = () => leaf(context);
    this.tree = new BehaviourTree(TREE + goal.tree, agent, {
      random: botRandom(seed),
      getDeltaTime: () => 1 / TICK_RATE_HZ,
    });
  }

  think(view: BotWorldView): SimInputs {
    const { self } = view;
    this.view = view;
    this.steering = { moveDirection: IDLE_INPUTS.moveDirection, dash: false };
    this.buttons = { hitHeld: false, grabHeld: false };
    this.face = null;
    this.fought = false;
    this.noteRespawns(self);
    if (this.wasOutOfControl && !this.outOfControl(self)) {
      this.wasOutOfControl = false;
      this.recoveries += 1;
    }
    this.tree.step();
    if (this.bodyYaw === null || !isPlayerDrivenMotionState(self.motionState)) this.bodyYaw = modelYawFromFacing(self.facing);
    const { dash, jump = false, committed = false } = this.steering;
    // ADR 0129, "never suicidal" (M17 ticket 06): whoever asked for the move,
    // the goal or the Fight, it is sent only if it keeps the Bot on its floor.
    // A proven link's own input is the one move toward an edge on purpose.
    const asked = this.steering.moveDirection;
    const moveDirection = committed ? asked : this.guard.guard(view, asked, dash, !this.fought, this.steering.drift ?? null);
    // A Dash locks its direction at the press: never pressed on a move the guard turned.
    const dashHeld = dash && moveDirection === asked;
    this.guard.record(moveDirection, dashHeld);
    // The Fight turns a standing body toward its target (M17 ticket 09); a
    // carrier turns as slowly as its client would (ADR 0104/0125), so the
    // facing sent is one the step accepts as it is.
    this.bodyYaw = nextModelYaw({ currentYaw: this.bodyYaw, moveDirection: this.face ?? moveDirection, deltaSeconds: TICK_DT, turnScale: this.turnScale(view) });
    return { ...IDLE_INPUTS, ...this.buttons, moveDirection, dashHeld, jumpHeld: jump, facing: facingFromModelYaw(this.bodyYaw) };
  }

  /** What this Bot's Fight has done so far (M17 ticket 09): read by suites, never by the Bot. */
  get fightTally(): Readonly<FightTally> {
    return this.fighter.tally;
  }

  /** Whether this Tick's input was the Fight's rather than the Round goal's (M17 ticket 09). */
  get fighting(): boolean {
    return this.fought;
  }

  /** How fast this Bot's body turns, as a client's would: slower carrying a Character or a Prop (ADR 0104/0125). */
  private turnScale({ self, track }: BotWorldView): number {
    if (self.grabbingId !== null) return GRAB_TURN_SPEED_MULTIPLIER;
    const mass = self.carryingProp === null ? undefined : track.resolved.props[self.carryingProp]?.mass;
    return mass === undefined ? 1 : propCarryTurn(mass);
  }

  private currentView(): BotWorldView {
    if (this.view === null) throw new Error("a Bot's tree was stepped outside think()");
    return this.view;
  }

  /** Down, Held, or fallen and not yet put back: the Character is not this Bot's to drive. */
  private outOfControl(self: Readonly<CharacterSnapshot>): boolean {
    if (self.eliminated) return false;
    return isDownMotionState(self.motionState) || self.motionState === "Held" || self.fallCount > this.fallsRespawned!;
  }

  private noteRespawns(self: Readonly<CharacterSnapshot>): void {
    if (this.respawnsSeen === null || self.respawnCount !== this.respawnsSeen) {
      this.respawnsSeen = self.respawnCount;
      this.fallsRespawned = self.fallCount;
    }
  }
}
