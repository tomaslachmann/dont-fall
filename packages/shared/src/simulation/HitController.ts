import { HIT_COOLDOWN_TICKS } from "../tuning.js";
import { CooldownController } from "./CooldownController.js";

/**
 * Hit's cooldown bookkeeping (M6 ticket 03). A swing either fires this tick
 * (cooldown was 0) or it doesn't, with no ongoing effect of its own to
 * advance afterward — unlike Dash, there is no burst/duration/direction to
 * also track, so this is `CooldownController` with nothing added beyond the
 * fire decision itself.
 *
 * Whether a fired swing actually *connects* with anyone is a separate,
 * cross-Character question only `RapierSimulation` can answer (it alone
 * knows every Character's position) — this class only ever answers "may I
 * swing right now."
 */
export class HitController extends CooldownController {
  /** Advance cooldown bookkeeping; returns whether a swing actually fires this tick. */
  beginTick(hitPressed: boolean): boolean {
    this.tickDown();
    if (hitPressed && this.ready) {
      this.startCooldown(HIT_COOLDOWN_TICKS);
      return true;
    }
    return false;
  }

  /** Restore the cooldown from a reconciliation base (M6 ticket 03) — the server's `hitCooldownMs`, rounded back to whole ticks. */
  restoreCooldownMs(ms: number): void {
    this.cooldownTicks = this.cooldownTicksFromMs(ms);
  }
}
