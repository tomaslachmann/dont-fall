import { GRAB_COOLDOWN_TICKS } from "../tuning.js";
import { CooldownController } from "./CooldownController.js";

/**
 * Grab's cooldown bookkeeping (M6 ticket 04) — unlike `DashController`/
 * `HitController`, the cooldown does not start the instant a press is
 * accepted: CONTEXT.md's own Grab definition says "cooldown after"
 * (release), not after the grab itself. `beginTick` only ever answers "may I
 * initiate a grab this tick" (cooldown-gated, like every other verb here);
 * starting the cooldown is {@link release}'s job, called once whatever hold
 * this Character initiated has actually ended, however it ended.
 *
 * The hold itself (who's grabbing whom, how long it's lasted, whether the
 * held Character is struggling free) is cross-Character state only
 * `RapierSimulation` can resolve — this class, like `HitController`, only
 * ever answers the single-Character question.
 */
export class GrabController extends CooldownController {
  /** Advance cooldown bookkeeping; returns whether a grab may be initiated this tick. */
  beginTick(grabPressed: boolean): boolean {
    this.tickDown();
    return grabPressed && this.ready;
  }

  /** Starts the cooldown — call once a hold this Character initiated has ended. */
  release(): void {
    this.startCooldown(GRAB_COOLDOWN_TICKS);
  }

  /** Restore the cooldown from a reconciliation base (M6 ticket 04) — the server's `grabCooldownMs`, rounded back to whole ticks. */
  restoreCooldownMs(ms: number): void {
    this.cooldownTicks = this.cooldownTicksFromMs(ms);
  }
}
