import { TICK_MS } from "../tuning.js";

/**
 * Shared cooldown bookkeeping for the project's cooldown-gated verbs
 * (`DashController`, `HitController`) — the tick-counting/ms-conversion
 * arithmetic every one of them needs is identical; only what happens the
 * instant a press is accepted (a multi-tick burst, a one-shot swing) differs,
 * which is exactly why that part stays in each subclass rather than here.
 *
 * Subclasses call the `protected` primitives from their own `beginTick` (whose
 * signature necessarily differs per verb — a direction and a boolean for
 * Dash, just a boolean for Hit — so it is not declared here at all) and
 * define their own public `restoreCooldownMs`, since Dash's needs an extra
 * `stillDashing` parameter to also re-derive its burst progress; only the
 * ms/ticks conversion the two use is here (`cooldownTicksFromMs`).
 */
export class CooldownController {
  protected cooldownTicks = 0;

  reset(): void {
    this.cooldownTicks = 0;
  }

  /** Milliseconds left on the cooldown; 0 when ready. */
  get cooldownMs(): number {
    return this.cooldownTicks * TICK_MS;
  }

  /** Whether the cooldown has fully elapsed. */
  protected get ready(): boolean {
    return this.cooldownTicks === 0;
  }

  /** Advance the cooldown by one tick. Call exactly once per `beginTick`, regardless of whether anything fires. */
  protected tickDown(): void {
    if (this.cooldownTicks > 0) this.cooldownTicks -= 1;
  }

  protected startCooldown(ticks: number): void {
    this.cooldownTicks = ticks;
  }

  protected cooldownTicksFromMs(ms: number): number {
    return Math.max(0, Math.round(ms / TICK_MS));
  }
}
