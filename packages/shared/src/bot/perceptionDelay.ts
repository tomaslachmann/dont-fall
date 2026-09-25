import type { SimInputs } from "../simulation/SimInputs.js";
import { BOT_STUMBLE_EXTRA_TICKS_MAX } from "../tuning/bots.js";
import type { Bot, BotWorldView } from "./Bot.js";
import type { BotProfile } from "./profile.js";
import { botRandom } from "./random.js";

/**
 * The part of a {@link BotWorldView} a delayed Bot perceives late: everything
 * that changes Tick to Tick. `props` and `bombs` (M17 ticket 09) are plain
 * Snapshot rows like `characters`, with no WASM handle in them, so they are
 * delayed with it: a Bot sees a thrown cone and a lit fuse as late as it sees
 * the Character who threw it. So is `fragile` (M17 ticket 07): a floor's
 * crack is seen as late as the Character who cracked it. `runningFromTick`
 * passes through: it is the Round's own, like `tick`.
 */
type Perceived = Pick<BotWorldView, "self" | "characters" | "props" | "bombs" | "fragile">;

/**
 * Reaction time as a delay line on what a Bot perceives, never on what it
 * outputs (M17 ticket 08, ADR 0129): `inner.think` is still called, and
 * returns an input, every Tick — only {@link Perceived} (`self`,
 * `characters`: every Character's pose and motion state; `props`/`bombs`,
 * M17 ticket 09) is a few Ticks old,
 * so a wrapped Bot reacts late to the world instead of pressing late.
 * `view.tick`, `view.track` and `view.rules` are never delayed: `tick` is the
 * Tick the input is *for*, and `track`/`rules` are the Round's own, not
 * something a Bot perceives Tick to Tick. That matters beyond correctness —
 * `track` holds the navmesh, which a Round transition disposes; buffering it
 * would let a stale Tick hand a disposed navmesh to `PathFollower` a few
 * Ticks into the next Round.
 *
 * Clumsiness (`profile.clumsiness`) widens that staleness further, drawn
 * fresh every Tick: a clumsy Bot's view is sometimes several Ticks staler
 * than its steady `reactionTicks`, as if it had stumbled. A stumble only
 * ever makes perception *later* — it never touches where a Bot is aimed.
 * What it produces, as a side effect of the wrapped Bot planning and
 * steering from a stale position, is the two things ticket 08 asks
 * clumsiness for: a late reaction, and an overshoot past where it meant to
 * turn. Beside an edge that overshoot is a step off (measured, M17 ticket
 * 06), so a Bot knows its own window (`staleWindow`, from this same
 * profile) and its `EdgeGuard` only sends a move that is safe wherever the
 * lag may have left it (ADR 0129's "never suicidal").
 */
export const withPerceptionDelay = (inner: Bot, profile: BotProfile, seed: string): Bot => {
  const { reactionTicks, clumsiness } = profile;
  if (reactionTicks <= 0 && clumsiness <= 0) return inner;
  const stumble = botRandom(`${seed}\u0000stumble`);
  const maxDelay = reactionTicks + BOT_STUMBLE_EXTRA_TICKS_MAX;
  const buffer: Perceived[] = [];
  return {
    think(view: BotWorldView): SimInputs {
      buffer.push({ self: view.self, characters: view.characters, props: view.props, bombs: view.bombs, fragile: view.fragile });
      // Bounded: nothing staler than `maxDelay` Ticks is ever read.
      if (buffer.length > maxDelay + 1) buffer.splice(0, buffer.length - (maxDelay + 1));
      const delay = reactionTicks + Math.floor(clumsiness * BOT_STUMBLE_EXTRA_TICKS_MAX * stumble());
      const delayed = buffer[Math.max(0, buffer.length - 1 - delay)]!;
      return inner.think({ ...view, self: delayed.self, characters: delayed.characters, props: delayed.props, bombs: delayed.bombs, fragile: delayed.fragile });
    },
  };
};
