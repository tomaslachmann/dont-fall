/**
 * A deterministic draw in `[0, 1)` for a one-off chance inside the
 * simulation step (ADR 0092) — today, whether a hard landing on ice puts a
 * Character down.
 *
 * `Math.random()` is not available to the step: it is pure with respect to
 * `(state, inputs)` (ADR 0003/0005), the client predicts its own Character
 * with it, and the server is the authority. A real random number would make
 * every coin flip a disagreement — the client would guess wrong half the
 * time and be corrected, which is exactly the jitter prediction exists to
 * avoid. Drawing from values *both sides already have* (the Character's id
 * and the tick the landing resolved on) gives the same number on both, so a
 * predicted slip is a slip and a predicted recovery is a recovery.
 *
 * The mix is FNV-1a over the id, folded with the tick through the
 * xorshift/multiply finalizer from `splitmix32`. It needs to be well
 * distributed across neighbouring ticks and across ids, which this is; it
 * does not need to be cryptographic, and nothing here is a secret.
 */
export const slipRoll = (id: string, tick: number): number => {
  // FNV-1a over the id.
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Fold the tick in, then finalize — without the finalizer, consecutive
  // ticks land on near-consecutive outputs and a "50% chance" becomes a
  // visible alternating pattern.
  let x = (hash ^ Math.imul(tick | 0, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 0x1_0000_0000;
};
