import {
  TICK_MS,
  characterSnapshot,
  interpolateState,
  type CharacterSnapshot,
  type RenderCharacter,
  type SimState,
} from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { SnapshotInterpolator } from "../net/snapshotInterpolation.js";
import { heldSinceTickAfter, ownDrawnFromServer } from "./frameLoop.js";

const state = (tick: number, me: CharacterSnapshot): SimState => ({ tick, characters: { me }, props: [] });

/** The local Character as the drawn (interpolated) server world has it. */
const drawn = (fields: Parameters<typeof characterSnapshot>[0]): RenderCharacter => {
  const only = state(1, characterSnapshot(fields));
  return interpolateState(only, only, 1).characters.me!;
};

const at = { x: 0, y: 1, z: 0 };
const bones = [{ position: { x: 0, y: 0.6, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }];
/** A drawn world with no hold Tick to wait for — none recorded, or one taken already down. */
const untimed = { drawnTick: 1, heldSinceTick: null };

describe("ownDrawnFromServer — a Held own body switches once the drawn world shows the hold (ADR 0104, ADR 0109)", () => {
  // Repaired for ADR 0109's third argument, the drawn tick and the Tick a hold
  // began on; none of these cases has one to wait for.
  it("keeps drawing the prediction while the drawn world still has the caught Character on its feet", () => {
    // The prediction turned Held on the newest Snapshot; the drawn world is
    // the Interpolation Delay behind it, still before the catch.
    expect(ownDrawnFromServer("Held", drawn({ position: at, motionState: "Controlled" }), untimed)).toBe(false);
    expect(ownDrawnFromServer("Held", drawn({ position: at, motionState: "Stagger" }), untimed)).toBe(false);
  });

  it("draws from the server once the drawn world has the Character Held", () => {
    expect(ownDrawnFromServer("Held", drawn({ position: at, motionState: "Held", heldByGrabberId: "them" }), untimed)).toBe(true);
  });

  it("keeps drawing the server's body when the catch picked up a Character already down", () => {
    // It was drawn from the server while down; it stays so until the hold shows.
    expect(ownDrawnFromServer("Held", drawn({ position: at, motionState: "Ragdoll", bones }), untimed)).toBe(true);
  });

  it("never draws a body its own Player moves from the server, however far behind the drawn world is", () => {
    // Up again, or let go and landed on its feet, while the drawn world still has it held or down.
    expect(ownDrawnFromServer("Controlled", drawn({ position: at, motionState: "Held", heldByGrabberId: "them" }), untimed)).toBe(false);
    expect(ownDrawnFromServer("Controlled", drawn({ position: at, motionState: "GettingUp", bones }), untimed)).toBe(false);
  });

  it("draws the prediction when the drawn world has no row for the Character yet", () => {
    expect(ownDrawnFromServer("Held", undefined, untimed)).toBe(false);
  });
});

/**
 * ADR 0109: the drawn row takes its state from the later Snapshot, so between
 * the last Tick on the feet and the first Held one it already reads Held while
 * its position is still lerped up from the ground — drawn, the caught body fell
 * out of the hands the prediction had drawn it in, then rose again.
 */
describe("ownDrawnFromServer — a hold taken on the feet waits for the Tick it began on (ADR 0109)", () => {
  const C = 300;
  const STOOD = { x: 0, y: 1, z: 1.8 };
  const CARRIED = { x: 0, y: 1.4, z: 1.1 };
  const onFeet = (tick: number) => state(tick, characterSnapshot({ position: STOOD, motionState: "Controlled" }));
  const knockedDown = (tick: number) =>
    state(tick, characterSnapshot({ position: { ...STOOD, y: 0.3 }, motionState: "Ragdoll", bones }));
  const held = (tick: number) =>
    state(tick, characterSnapshot({ position: CARRIED, motionState: "Held", heldByGrabberId: "them" }));

  it("keeps drawing the prediction on a frame whose drawn row reads Held but is still lerped up from where it stood", () => {
    const row = interpolateState(onFeet(C - 1), held(C), 0.2).characters.me!;
    expect(row.motionState).toBe("Held");
    expect(row.position.y).toBeLessThan(CARRIED.y);
    const heldSinceTick = heldSinceTickAfter(null, "Controlled", "Held", C);
    expect(ownDrawnFromServer("Held", row, { drawnTick: C - 0.8, heldSinceTick })).toBe(false);
  });

  it("draws from the server once the drawn tick reaches the Tick the hold began on", () => {
    const heldSinceTick = heldSinceTickAfter(null, "Stagger", "Held", C);
    const reached = interpolateState(onFeet(C - 1), held(C), 1).characters.me!;
    expect(reached.position).toEqual(CARRIED);
    expect(ownDrawnFromServer("Held", reached, { drawnTick: C, heldSinceTick })).toBe(true);
    const past = interpolateState(held(C), held(C + 1), 0.4).characters.me!;
    expect(ownDrawnFromServer("Held", past, { drawnTick: C + 0.4, heldSinceTick })).toBe(true);
  });

  it("draws a hold taken on a Character already down from the server throughout", () => {
    const heldSinceTick = heldSinceTickAfter(null, "Ragdoll", "Held", C);
    expect(heldSinceTick).toBeNull();
    const frames: [RenderCharacter, number][] = [
      [interpolateState(knockedDown(C - 2), knockedDown(C - 1), 0.5).characters.me!, C - 1.5],
      [interpolateState(knockedDown(C - 1), held(C), 0.2).characters.me!, C - 0.8],
      [interpolateState(held(C), held(C + 1), 0.5).characters.me!, C + 0.5],
    ];
    for (const [row, drawnTick] of frames) expect(ownDrawnFromServer("Held", row, { drawnTick, heldSinceTick })).toBe(true);
  });

  it("never drops the caught body out of the hands, over a real interpolation buffer at 60 and 144 Hz", () => {
    // 40 ms one way, a little jitter; the server carries the Character from Tick C.
    const arrivalMs = (tick: number): number => tick * TICK_MS + 40 + 2 * Math.abs(Math.sin(tick));
    for (const hz of [60, 144]) {
      const interp = new SnapshotInterpolator();
      let heldSinceTick: number | null = null;
      let newest: SimState | null = null;
      let arrived = 0;
      const heights: number[] = [];
      for (let now = 0; now < (C + 20) * TICK_MS; now += 1000 / hz) {
        while (arrivalMs(arrived + 1) <= now) {
          arrived += 1;
          const snapshot = arrived < C ? onFeet(arrived) : held(arrived);
          heldSinceTick = heldSinceTickAfter(
            heldSinceTick,
            newest?.characters.me?.motionState,
            snapshot.characters.me!.motionState,
            snapshot.tick,
          );
          newest = snapshot;
          interp.receive(snapshot, arrivalMs(arrived));
        }
        if (!interp.ready || !newest) continue;
        const serverOwn = interp.sample(now).characters.me;
        // The prediction is reconciled to the newest Snapshot, and nothing moves a Held body locally.
        const own = newest.characters.me!;
        const fromServer = ownDrawnFromServer(own.motionState, serverOwn, { drawnTick: interp.renderTick(now), heldSinceTick });
        heights.push(fromServer ? serverOwn.position.y : own.position.y);
      }
      const lifted = heights.findIndex((y) => y === CARRIED.y);
      expect(lifted).toBeGreaterThan(0);
      expect(Math.min(...heights.slice(lifted))).toBe(CARRIED.y);
    }
  });
});

describe("heldSinceTickAfter — the Tick a hold taken on the feet began on (ADR 0109)", () => {
  it("records the first Held Snapshot's Tick after one on the feet, and keeps it while the hold lasts", () => {
    expect(heldSinceTickAfter(null, "Sliding", "Held", 40)).toBe(40);
    expect(heldSinceTickAfter(40, "Held", "Held", 41)).toBe(40);
  });

  it("clears it when the hold ends, and records none for a hold taken down or first seen held", () => {
    expect(heldSinceTickAfter(40, "Held", "Ragdoll", 90)).toBeNull();
    expect(heldSinceTickAfter(40, "Held", "Controlled", 90)).toBeNull();
    expect(heldSinceTickAfter(null, "GettingUp", "Held", 40)).toBeNull();
    expect(heldSinceTickAfter(null, undefined, "Held", 40)).toBeNull();
  });
});
