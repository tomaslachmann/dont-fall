import type { PongMessage } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { TimeSync } from "./timeSync.js";

/**
 * The server's `performance.now()` leads the client's by `TRUE_OFFSET`. A pong
 * for a ping sent at client-time `t1`, symmetric latency `owd` each way, carries
 * `serverTimeMs = (t1 + owd) + TRUE_OFFSET` and is received at `t1 + 2*owd`.
 */
const TRUE_OFFSET = 5000;
const pong = (t1: number, owdMs: number): { msg: PongMessage; t4: number } => ({
  msg: { type: "pong", clientTimeMs: t1, serverTimeMs: t1 + owdMs + TRUE_OFFSET },
  t4: t1 + 2 * owdMs,
});

describe("TimeSync", () => {
  it("recovers the true clock offset from symmetric round trips", () => {
    const ts = new TimeSync();
    for (let i = 0; i < 8; i += 1) {
      const { msg, t4 } = pong(i * 100, 20);
      ts.receivePong(msg, t4);
    }
    expect(ts.ready).toBe(true);
    expect(ts.serverClockOffsetMs).toBeCloseTo(TRUE_OFFSET, 0);
    expect(ts.rttMs).toBeCloseTo(40, 0);
  });

  it("prefers the lowest-RTT sample and rejects a wild outlier", () => {
    const ts = new TimeSync();
    // Mostly clean 20 ms one-way trips...
    for (let i = 0; i < 10; i += 1) ts.receivePong(...toArgs(pong(i * 100, 20)));
    // ...then a spike where the reply was delayed 200 ms extra on the way back,
    // which skews that sample's offset. It must not move the estimate much.
    ts.receivePong({ type: "pong", clientTimeMs: 2000, serverTimeMs: 2020 + TRUE_OFFSET }, 2000 + 240);
    expect(ts.serverClockOffsetMs).toBeCloseTo(TRUE_OFFSET, -1); // within ~10 ms
  });

  it("slews toward a shifted offset at a bounded rate, not instantly", () => {
    const ts = new TimeSync();
    for (let i = 0; i < 8; i += 1) ts.receivePong(...toArgs(pong(i * 100, 20)));
    const start = ts.serverClockOffsetMs;

    // The server clock jumps +40 ms (a small step — under the snap threshold).
    for (let i = 0; i < 16; i += 1) {
      const t1 = 1000 + i * 100;
      ts.receivePong({ type: "pong", clientTimeMs: t1, serverTimeMs: t1 + 20 + TRUE_OFFSET + 40 }, t1 + 40);
    }
    ts.tick(100); // 100 ms of frame time → ≤ 2.5 ms of correction
    expect(ts.serverClockOffsetMs - start).toBeGreaterThan(0);
    expect(ts.serverClockOffsetMs - start).toBeLessThan(5); // nowhere near the full 40 yet
  });

  it("snaps for a large step change (over the threshold)", () => {
    const ts = new TimeSync();
    for (let i = 0; i < 8; i += 1) ts.receivePong(...toArgs(pong(i * 100, 20)));

    for (let i = 0; i < 16; i += 1) {
      const t1 = 1000 + i * 100;
      ts.receivePong({ type: "pong", clientTimeMs: t1, serverTimeMs: t1 + 20 + TRUE_OFFSET + 300 }, t1 + 40);
    }
    ts.tick(16);
    expect(ts.serverClockOffsetMs).toBeCloseTo(TRUE_OFFSET + 300, -1);
  });

  it("ignores a nonsense round trip (suspended tab)", () => {
    const ts = new TimeSync();
    for (let i = 0; i < 8; i += 1) ts.receivePong(...toArgs(pong(i * 100, 20)));
    const before = ts.serverClockOffsetMs;
    ts.receivePong({ type: "pong", clientTimeMs: 0, serverTimeMs: 999999 }, 10_000);
    expect(ts.serverClockOffsetMs).toBe(before);
  });
});

const toArgs = ({ msg, t4 }: { msg: PongMessage; t4: number }): [PongMessage, number] => [msg, t4];
