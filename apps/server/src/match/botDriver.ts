import {
  TreeBot,
  botProfile,
  botTrackFromData,
  disposeBotTrack,
  withPerceptionDelay,
  type Bot,
  type BotLevel,
  type BotTrack,
  type MotionClock,
  type ResolvedTrack,
  type RoundRules,
  type SimInputs,
  type SimState,
} from "@dont-fall/shared";
import { workerBotTrackBuilder, type BotTrackBuilder } from "./botTracks.js";

/**
 * The Match's Bots (ADR 0129): the authority's own input source, run beside
 * `InputRouter` and read by the tick loop at the same point, so a Bot's
 * input reaches the step exactly where a Player's does.
 *
 * This is where the server knows a seat is a Bot, and the only place. The seat
 * itself is an ordinary `LobbyPlayer` row with no Account and no socket; the
 * Snapshot carries no flag, because no Screen marks a Bot.
 *
 * A Bot reads the world as of the last Tick simulated ({@link observe}), the
 * same world a Player with no latency would see, never the simulation itself.
 * The navmesh is built when a world is, and only on a Match that has a Bot to
 * read it, on the Bot track worker (M17 ticket 05): with its links proven it
 * costs up to a second, which on this loop would stall every Lobby in the
 * process. Until it arrives the Bots stand still, and {@link ready} holds the
 * Round in LOADING (ADR 0089), so no Countdown starts without them.
 */
export class BotDriver {
  private readonly bots = new Map<string, Bot>();
  /** The world the current simulation was built from, kept so a first Bot can build its navmesh late. */
  private resolved: ResolvedTrack | null = null;
  private track: BotTrack | null = null;
  /** Which world a build in flight is for: a build for a world since replaced is dropped. */
  private generation = 0;
  private building = false;
  /** The last build failed: the Bots stand still rather than hold the Round forever. */
  private failed = false;

  constructor(private readonly buildTrack: BotTrackBuilder = workerBotTrackBuilder) {}
  /** The last Tick's state, or `null` when the world was replaced since. */
  private lastState: SimState | null = null;

  get size(): number {
    return this.bots.size;
  }

  has(id: string): boolean {
    return this.bots.has(id);
  }

  ids(): IterableIterator<string> {
    return this.bots.keys();
  }

  /**
   * Seats a Bot at `level` (ADR 0129, M17 ticket 08): one `TreeBot`, its
   * `BotProfile` drawn from the Match and this seat — so no two Bots in a
   * Lobby share one, and a suite's own `matchId` makes the draw repeatable —
   * wrapped in `withPerceptionDelay` for its reaction time and clumsiness.
   * `level` defaults to NORMAL for the ticket 03 test hook, which seats a
   * Bot with no Lobby setting to read.
   */
  add(id: string, matchId: string, level: BotLevel = "normal"): void {
    const seed = `${matchId}:${id}`;
    const profile = botProfile(level, seed);
    this.bots.set(id, withPerceptionDelay(new TreeBot({ seed, profile }), profile, seed));
    this.ensureTrack();
  }

  remove(id: string): void {
    this.bots.delete(id);
  }

  /**
   * The simulation was rebuilt on `resolved`: every Bot's navmesh is for the
   * old Track, and so is the last state it saw. Called by every rebuild, with
   * or without Bots, so a Bot added later still finds the world.
   */
  worldChanged(resolved: ResolvedTrack): void {
    if (this.track !== null) disposeBotTrack(this.track);
    this.track = null;
    this.generation += 1;
    this.building = false;
    this.failed = false;
    this.resolved = resolved;
    this.lastState = null;
    this.ensureTrack();
  }

  /** What the tick loop simulated last: the world every Bot reads next Tick. */
  observe(state: SimState): void {
    this.lastState = state;
  }

  /**
   * Every Bot's input for `tick`, written into `inputs` beside the Players'.
   * `clock` is the Motion Clock (ADR 0123) every Bot foresees a Motion by
   * (M17 ticket 07). `snapshot` is read only when the world was replaced
   * since the last Tick, so a fresh world's first Tick still has something
   * to read.
   */
  inputsFor(tick: number, rules: RoundRules, clock: MotionClock, snapshot: () => SimState, inputs: Record<string, SimInputs>): void {
    if (this.bots.size === 0 || this.track === null) return;
    const state = (this.lastState ??= snapshot());
    // A gone fragile block is nobody's route (M17 ticket 07): flagged from the world as it is, not as any Bot sees it.
    this.track.moving.syncFragile(this.track.nav, state.fragile);
    for (const [id, bot] of this.bots) {
      const self = state.characters[id];
      // A Bot seated after the last Tick has no Character in that state yet.
      if (self === undefined) continue;
      // Props and Bombs (M17 ticket 09) are the Snapshot's own rows, plain data like `characters`.
      inputs[id] = bot.think({
        tick,
        id,
        self,
        characters: state.characters,
        props: state.props,
        bombs: state.bombs ?? [],
        track: this.track,
        rules,
        runningFromTick: clock,
        fragile: state.fragile,
      });
    }
  }

  /**
   * Whether every Bot can play this world: none are seated, or their navmesh
   * has arrived (or failed to, in which case they stand still). The LOADING
   * gate reads it beside the clients' own `loaded`.
   */
  ready(): boolean {
    return this.bots.size === 0 || this.track !== null || this.failed;
  }

  /** Resolves once {@link ready} holds: for suites, which turn the clock themselves. */
  async whenReady(): Promise<void> {
    while (!this.ready()) await new Promise((resolve) => setTimeout(resolve, 5));
  }

  /** Frees the navmesh (the server closing). A build still in flight is dropped. */
  dispose(): void {
    if (this.track !== null) disposeBotTrack(this.track);
    this.track = null;
    this.generation += 1;
    this.building = false;
  }

  private ensureTrack(): void {
    if (this.track !== null || this.building || this.failed || this.bots.size === 0 || this.resolved === null) return;
    const resolved = this.resolved;
    const generation = this.generation;
    this.building = true;
    this.buildTrack(resolved).then(
      (data) => {
        if (generation !== this.generation) return;
        this.building = false;
        this.track = botTrackFromData(resolved, data);
      },
      (error: Error) => {
        if (generation !== this.generation) return;
        this.building = false;
        this.failed = true;
        console.error(`DON'T FALL: the Bots' navmesh could not be built, so they will stand still: ${error.message}`);
      },
    );
  }
}
