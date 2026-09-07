import { IDLE_INPUTS, MAX_QUEUED_INPUTS, type SimInputs } from "@dont-fall/shared";

/**
 * The per-client input queue between the socket and the tick loop (ADR 0021,
 * ADR 0027).
 *
 * A short queue absorbs network jitter and reordering; `lastApplied` fills a
 * tick a client's packet hasn't arrived for yet; and `lastInputTick` — the
 * server tick actually simulated, whether a real input matched it or
 * `lastApplied` repeated — is echoed in the snapshot as the reconciliation
 * acknowledgement (ADR 0013), honestly, so the client replays exactly the
 * inputs the server hasn't processed yet.
 *
 * The three maps move together because they are one idea, and every rule about
 * them (dedupe by tick, drop the stale, cap the depth) only makes sense with
 * all three in view.
 */
export class InputRouter {
  private readonly queues = new Map<string, { tick: number; input: SimInputs }[]>();
  private readonly lastApplied = new Map<string, SimInputs>();
  private readonly lastInputTicks = new Map<string, number>();

  add(id: string): void {
    this.queues.set(id, []);
    this.lastApplied.set(id, IDLE_INPUTS);
    this.lastInputTicks.set(id, 0);
  }

  remove(id: string): void {
    this.queues.delete(id);
    this.lastApplied.delete(id);
    this.lastInputTicks.delete(id);
  }

  /**
   * Accept one `input` packet. Each carries the current input plus a redundant
   * tail of recent ones (ADR 0021): deduped by tick against what has been
   * applied and what is already queued, so a head-of-line burst or a reorder
   * loses nothing.
   */
  receive(id: string, inputs: { tick: number; input: SimInputs }[]): void {
    const queue = this.queues.get(id);
    if (!queue) return;
    for (const entry of inputs) {
      if (typeof entry?.tick !== "number" || !Number.isFinite(entry.tick)) continue;
      if (entry.tick <= (this.lastInputTicks.get(id) ?? 0)) continue;
      if (queue.some((q) => q.tick === entry.tick)) continue;
      queue.push({ tick: entry.tick, input: entry.input });
    }
    queue.sort((a, b) => a.tick - b.tick);
    while (queue.length > MAX_QUEUED_INPUTS) queue.shift();
  }

  /**
   * The input to simulate for `id` at `tick` (ADR 0027 — addressed by tick
   * number, never next-in-queue), consuming it and anything older that is now
   * moot. Records the ack for this tick whether a real input matched it or
   * `lastApplied` repeated: never left behind at the last tick a *distinct*
   * input happened to land on.
   */
  takeFor(id: string, tick: number): SimInputs {
    const queue = this.queues.get(id);
    if (queue) {
      const idx = queue.findIndex((q) => q.tick === tick);
      if (idx >= 0) {
        this.lastApplied.set(id, queue[idx]!.input);
        queue.splice(0, idx + 1); // consumed, plus anything older that's now moot
      } else {
        while (queue.length && queue[0]!.tick < tick) queue.shift(); // stale — never coming
      }
    }
    this.lastInputTicks.set(id, tick);
    return this.lastApplied.get(id) ?? IDLE_INPUTS;
  }

  /** The reconciliation acknowledgement echoed in the snapshot (ADR 0013). */
  lastInputTick(id: string): number {
    return this.lastInputTicks.get(id) ?? 0;
  }

  /** How many of this client's commands are buffered but not yet applied — feeds its LEAD (ADR 0021). */
  depth(id: string): number {
    return this.queues.get(id)?.length ?? 0;
  }
}
