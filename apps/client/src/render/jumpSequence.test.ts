import {
  GRAVITY_Y,
  JUMP_HOLD_GRAVITY_SCALE,
  JUMP_HOLD_MAX_MS,
  JUMP_VELOCITY,
  launchHeightToSpeed,
} from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { pinClipPose, type CharacterActions } from "./characterModel.js";
import {
  BRACE_SECONDS,
  FLOAT_LOOP_FROM,
  FLOAT_LOOP_TO,
  FLOAT_RELEASE_MS,
  JumpSequences,
  LANDING_MIN_AIRBORNE_MS,
  LANDING_MOVING_RATE,
  MAX_PLAYBACK_RATE,
  floatLoopTarget,
  jumpPoseAt,
  jumpTimeline,
  type JumpFrame,
  type JumpTimeline,
} from "./jumpSequence.js";

/** A rig with every jump clip the real BLIP.glb carries, at its real duration. */
const rig = () => {
  const mixer = new THREE.AnimationMixer(new THREE.Object3D());
  const clip = (name: string, d: number) =>
    mixer.clipAction(
      new THREE.AnimationClip(name, d, [new THREE.VectorKeyframeTrack(".position", [0, d], [0, 0, 0, 0, 0, 0])]),
    );
  return {
    mixer,
    actions: {
      idle: null, walk: null, run: null,
      jumpStart: clip("Jump_Start", 0.367),
      jumpRise: clip("Jump_Rise", 0.267),
      jumpApex: clip("Jump_Apex", 0.2),
      jumpFall: clip("Jump_Fall", 0.267),
      jumpLand: clip("Jump_Land", 0.5),
      punch: null, hitReact: null,
      ko: { F: null, FL: null, FR: null, B: null, BL: null, BR: null },
      getUp: { F: null, FL: null, FR: null, B: null, BL: null, BR: null },
      death: { F: null, FL: null, FR: null, B: null, BL: null, BR: null },
      grabReach: null, grabPull: null, grabHold: null, grabDropOut: null,
      struggleHeld: null, struggleAir: null, wobble: null, wobbleWalk: null,
    } satisfies CharacterActions,
  };
};

describe("jumpTimeline", () => {
  it("lays BLIP's five pieces end to end", () => {
    const timeline = jumpTimeline(rig().actions)!;
    expect(timeline.liftoff).toBeCloseTo(0.367);
    expect(timeline.apex).toBeCloseTo(0.367 + 0.267 + 0.1);
    expect(timeline.contact).toBeCloseTo(1.101);
    expect(timeline.brace).toBeCloseTo(1.101 - BRACE_SECONDS);
    expect(timeline.end).toBeCloseTo(1.601);
  });

  it("gives a missing piece no time, and a rig with no air pieces no timeline", () => {
    const { actions } = rig();
    const noApex = jumpTimeline({ ...actions, jumpApex: null })!;
    expect(noApex.apex).toBeCloseTo(0.367 + 0.267);
    expect(noApex.contact).toBeCloseTo(0.901);
    expect(jumpTimeline({ ...actions, jumpStart: null, jumpRise: null, jumpApex: null, jumpFall: null })).toBeNull();
  });
});

describe("jumpPoseAt", () => {
  it("finds the piece under the playhead, and the time within it", () => {
    const { actions } = rig();
    const at = (playhead: number) => {
      const pose = jumpPoseAt(playhead, actions)!;
      return [pose.action, pose.time] as const;
    };
    expect(at(0)).toEqual([actions.jumpStart, 0]);
    expect(at(0.3)).toEqual([actions.jumpStart, 0.3]);
    expect(at(0.367)[0]).toBe(actions.jumpRise);
    expect(at(0.7)[0]).toBe(actions.jumpApex);
    expect(at(0.7)[1]).toBeCloseTo(0.7 - 0.634);
    expect(at(1)[0]).toBe(actions.jumpFall);
    expect(at(1.2)[0]).toBe(actions.jumpLand);
    expect(at(1.2)[1]).toBeCloseTo(1.2 - 1.101);
    // At (or past) the very end: the landing's last frame.
    expect(at(1.601)).toEqual([actions.jumpLand, 0.5]);
  });

  it("steps over a missing piece", () => {
    const { actions } = rig();
    const pose = jumpPoseAt(0.5, { ...actions, jumpRise: null })!;
    expect(pose.action).toBe(actions.jumpApex);
    expect(pose.time).toBeCloseTo(0.5 - 0.367);
  });
});

describe("pinClipPose", () => {
  it("holds the frame through a mixer update, even straight after a crossfade's reset", () => {
    const { mixer, actions } = rig();
    const rise = actions.jumpRise;
    rise.reset().fadeIn(0.08).play();
    pinClipPose({ action: rise, time: 0.2 });
    mixer.update(0.1);
    expect(rise.time).toBe(0.2);
  });
});

const DT = 1 / 60;

interface Flight {
  /** Vertical speed leaving the floor. */
  speed: number;
  held?: boolean;
  /** Height of the floor it comes down on, relative to the one it left. */
  floor?: number;
  moving?: boolean;
  /** Grounded frames after touchdown. */
  after?: number;
}

/** One flight at 60 fps, under the real jump tuning: airborne until it comes down on `floor`, then grounded. */
const fly = ({ speed, held = false, floor = 0, moving = false, after = 90 }: Flight): JumpFrame[] => {
  const frames: JumpFrame[] = [];
  let v = speed;
  let y = 0;
  let t = 0;
  const frame = (grounded: boolean): JumpFrame => ({
    grounded,
    verticalVelocity: grounded ? 0 : v,
    height: grounded ? floor : y,
    moving,
    deltaSeconds: DT,
    nowMs: 1000 + t * 1000,
  });
  for (;;) {
    frames.push(frame(false));
    const scale = held && v > 0 && t < JUMP_HOLD_MAX_MS / 1000 ? JUMP_HOLD_GRAVITY_SCALE : 1;
    v += GRAVITY_Y * scale * DT;
    y += v * DT;
    t += DT;
    if (v < 0 && y <= floor) break;
  }
  for (let i = 0; i < after; i += 1) {
    frames.push(frame(true));
    t += DT;
  }
  return frames;
};

const play = (frames: JumpFrame[], timeline: JumpTimeline, sequences = new JumpSequences(), id = "a") =>
  frames.map((frame) => sequences.advance(id, frame, timeline));

/**
 * The guarantee the bug report asked for, on one flight: the playhead starts
 * at the very first frame, only ever moves forward, never jumps by more than
 * the fastest allowed pace (so no frame is skipped), passes through every
 * piece, and ends the sequence once the landing has played out.
 */
const expectWhole = (frames: JumpFrame[], heads: (number | null)[], actions: CharacterActions, timeline: JumpTimeline) => {
  const shown = heads.filter((h): h is number => h !== null);
  expect(shown[0]).toBe(0);
  for (let i = 1; i < shown.length; i += 1) {
    expect(shown[i]!).toBeGreaterThanOrEqual(shown[i - 1]!);
    expect(shown[i]! - shown[i - 1]!).toBeLessThanOrEqual(MAX_PLAYBACK_RATE * DT + 1e-9);
  }
  expect(shown.at(-1)!).toBeGreaterThan(timeline.end - MAX_PLAYBACK_RATE * DT);
  const pieces = new Set(shown.map((h) => jumpPoseAt(h, actions)!.action));
  expect(pieces).toEqual(
    new Set([actions.jumpStart, actions.jumpRise, actions.jumpApex, actions.jumpFall, actions.jumpLand]),
  );
  // Over, and only once the feet were down.
  expect(heads.at(-1)).toBeNull();
  const lastShown = heads.length - 1 - [...heads].reverse().findIndex((h) => h !== null);
  expect(frames[lastShown]!.grounded).toBe(true);
};

/** The playhead on the last frame still rising, and on the last frame still in the air. */
const landmarks = (frames: JumpFrame[], heads: (number | null)[]) => ({
  atTop: heads[frames.findIndex((f) => !f.grounded && f.verticalVelocity <= 0) - 1]!,
  atTouchdown: heads[frames.findIndex((f) => f.grounded) - 1]!,
});

describe("JumpSequences", () => {
  const { actions } = rig();
  const timeline = jumpTimeline(actions)!;

  it("shows a plain jump whole — takeoff to landing — with the top of Apex at the top of the arc", () => {
    const frames = fly({ speed: JUMP_VELOCITY });
    const heads = play(frames, timeline);
    expectWhole(frames, heads, actions, timeline);
    const { atTop, atTouchdown } = landmarks(frames, heads);
    expect(atTop).toBeCloseTo(timeline.apex, 1);
    expect(atTouchdown).toBeCloseTo(timeline.brace, 1);
  });

  it("shows a held jump whole — the longer rise reaches the top early and waits there", () => {
    const frames = fly({ speed: JUMP_VELOCITY, held: true });
    const heads = play(frames, timeline);
    expectWhole(frames, heads, actions, timeline);
    const { atTop, atTouchdown } = landmarks(frames, heads);
    expect(atTop).toBe(timeline.apex);
    expect(atTouchdown).toBeCloseTo(timeline.brace, 1);
  });

  it("shows a Spring's long flight whole, slowed down rather than frozen on one piece", () => {
    const frames = fly({ speed: launchHeightToSpeed(10) });
    const heads = play(frames, timeline);
    expectWhole(frames, heads, actions, timeline);
    const air = heads.filter((h, i): h is number => h !== null && !frames[i]!.grounded);
    // Still moving through the arc well after the rig's own 1.1 s would have run out.
    expect(air.length * DT).toBeGreaterThan(1.5);
    expect(landmarks(frames, heads).atTouchdown).toBeCloseTo(timeline.brace, 1);
  });

  it("finishes the air quickly on the floor after landing early on a higher one", () => {
    const frames = fly({ speed: JUMP_VELOCITY, floor: 1.8 });
    const heads = play(frames, timeline);
    expectWhole(frames, heads, actions, timeline);
    expect(landmarks(frames, heads).atTouchdown).toBeLessThan(timeline.brace);
  });

  it("keeps the brace for the floor: a long drop waits just before it", () => {
    // Walking off a ledge: no push-off, so it joins the arc at the top.
    const frames = fly({ speed: 0, floor: -12 });
    const heads = play(frames, timeline);
    expect(heads[0]).toBe(timeline.apex);
    const air = heads.filter((h, i) => !frames[i]!.grounded);
    expect(Math.max(...(air as number[]))).toBe(timeline.brace);
    expect(landmarks(frames, heads).atTouchdown).toBe(timeline.brace);
    // ...and the landing still plays out in full.
    const shown = heads.filter((h): h is number => h !== null);
    expect(shown.at(-1)!).toBeGreaterThan(timeline.end - DT);
  });

  it("joins the arc where its speed sits when the feet leave slower than a push-off", () => {
    const sequences = new JumpSequences();
    const frame: JumpFrame = { grounded: false, verticalVelocity: 3, height: 0, moving: true, deltaSeconds: DT, nowMs: 0 };
    const head = sequences.advance("a", frame, timeline)!;
    expect(head).toBeCloseTo(timeline.apex - 0.3 * (timeline.apex - timeline.liftoff));
    expect(jumpPoseAt(head, actions)!.action).toBe(actions.jumpRise);
  });

  it("plays a standing landing at its own pace, and a mid-stride one faster, but always to the end", () => {
    const landingSeconds = (moving: boolean) => {
      const frames = fly({ speed: JUMP_VELOCITY, moving });
      const heads = play(frames, timeline);
      expectWhole(frames, heads, actions, timeline);
      return heads.filter((h, i) => h !== null && frames[i]!.grounded).length * DT;
    };
    const standing = landingSeconds(false);
    const running = landingSeconds(true);
    expect(standing).toBeCloseTo(timeline.end - timeline.brace, 1);
    expect(running).toBeCloseTo((timeline.end - timeline.brace) / LANDING_MOVING_RATE, 1);
  });

  it("draws no landing after a hop too short to count", () => {
    const sequences = new JumpSequences();
    const air = (nowMs: number): JumpFrame => ({
      grounded: false, verticalVelocity: -1, height: 0, moving: false, deltaSeconds: DT, nowMs,
    });
    sequences.advance("a", air(0), timeline);
    sequences.advance("a", air(LANDING_MIN_AIRBORNE_MS / 2), timeline);
    const down = { ...air(LANDING_MIN_AIRBORNE_MS - 1), grounded: true };
    expect(sequences.advance("a", down, timeline)).toBeNull();
    expect(sequences.advance("a", { ...down, nowMs: LANDING_MIN_AIRBORNE_MS + 50 }, timeline)).toBeNull();
  });

  it("starts over from the takeoff when the Character jumps again during the landing", () => {
    const sequences = new JumpSequences();
    const frames = fly({ speed: JUMP_VELOCITY, after: 5 });
    const heads = play(frames, timeline, sequences);
    expect(heads.at(-1)!).toBeGreaterThan(timeline.brace);
    const again: JumpFrame = { ...frames[0]!, nowMs: frames.at(-1)!.nowMs + 16 };
    expect(sequences.advance("a", again, timeline)).toBe(0);
  });

  it("starts over when launched again mid-air, but waits rather than rewinds when merely lifted", () => {
    const sequences = new JumpSequences();
    const air = (verticalVelocity: number, nowMs: number): JumpFrame => ({
      grounded: false, verticalVelocity, height: 0, moving: false, deltaSeconds: DT, nowMs,
    });
    const falling = sequences.advance("a", air(-3, 0), timeline)!;
    expect(falling).toBeGreaterThan(timeline.apex);
    // An updraft: rising again, but gently — the playhead holds its frame.
    expect(sequences.advance("a", air(-1, 16), timeline)).toBeGreaterThanOrEqual(falling);
    const lifted = sequences.advance("a", air(1, 33), timeline)!;
    expect(sequences.advance("a", air(2, 50), timeline)).toBe(lifted);
    // A launch pad: a real kick.
    expect(sequences.advance("a", air(2 + 12, 66), timeline)).toBe(0);
  });

  it("keeps each Character's sequence to itself, and forgets one on request", () => {
    const sequences = new JumpSequences();
    const takeoff: JumpFrame = { grounded: false, verticalVelocity: JUMP_VELOCITY, height: 0, moving: false, deltaSeconds: DT, nowMs: 0 };
    sequences.advance("a", takeoff, timeline);
    for (let i = 1; i <= 10; i += 1) sequences.advance("a", { ...takeoff, verticalVelocity: 8, nowMs: i * 16 }, timeline);
    expect(sequences.advance("b", takeoff, timeline)).toBe(0);
    expect(sequences.advance("a", { ...takeoff, verticalVelocity: 7.8, nowMs: 176 }, timeline)).toBeGreaterThan(0);

    sequences.forget("a");
    // Back on the floor after being forgotten: nothing left to land.
    expect(sequences.advance("a", { ...takeoff, grounded: true, nowMs: 1000 }, timeline)).toBeNull();
  });
});

describe("Floating (ADR 0077)", () => {
  const timeline = jumpTimeline(rig().actions)!;
  const span = timeline.brace - timeline.liftoff;
  const loopFrom = timeline.liftoff + FLOAT_LOOP_FROM * span;
  const loopTo = timeline.liftoff + FLOAT_LOOP_TO * span;

  /** The fan's field, as the sim runs it: 6 tall from the floor, force 40 capped at 10, under real gravity. */
  const COLUMN_TOP = 6;
  const FORCE = 40;
  const CAP = 10;

  interface RideFrame extends JumpFrame {
    playhead: number | null;
  }

  /**
   * A jump into the fan's updraft at 60 fps. The Character stays over the
   * fan for `hoverSeconds`, then drifts out and falls back to the floor.
   */
  const ride = (hoverSeconds: number, sequences = new JumpSequences()): RideFrame[] => {
    const frames: RideFrame[] = [];
    let v = JUMP_VELOCITY;
    let y = 0;
    let t = 0;
    let over = true;
    for (let i = 0; i < 60 * 30; i += 1) {
      if (t > hoverSeconds) over = false;
      const inUpdraft = over && y >= 0 && y <= COLUMN_TOP;
      const grounded = i > 0 && y <= 0 && v <= 0;
      const frame: JumpFrame = {
        grounded,
        verticalVelocity: grounded ? 0 : v,
        height: Math.max(0, y),
        moving: false,
        deltaSeconds: DT,
        nowMs: t * 1000,
        inUpdraft,
      };
      frames.push({ ...frame, playhead: sequences.advance("a", frame, timeline) });
      if (grounded && frames.length > 60 && !over) {
        if (frames.filter((f) => f.grounded).length > 60) break;
        continue;
      }
      v += GRAVITY_Y * DT;
      if (inUpdraft && v < CAP) v = Math.min(CAP, v + FORCE * DT);
      y += v * DT;
      if (y < 0) y = 0;
      t += DT;
    }
    return frames;
  };

  it("maps vertical speed onto the loop, both ways: pushed up to the rise end, weightless the apex, sinking the fall end", () => {
    expect(floatLoopTarget(0, 0, timeline)).toBeCloseTo(timeline.apex);
    expect(floatLoopTarget(JUMP_VELOCITY, 0, timeline)).toBeCloseTo(loopFrom);
    expect(floatLoopTarget(-JUMP_VELOCITY, 0, timeline)).toBeCloseTo(loopTo);
    expect(floatLoopTarget(JUMP_VELOCITY / 2, 0, timeline)).toBeCloseTo((timeline.apex + loopFrom) / 2);
    // Beyond the cap it stays on the loop.
    expect(floatLoopTarget(40, 0, timeline)).toBeCloseTo(loopFrom);
    expect(floatLoopTarget(-40, 0, timeline)).toBeCloseTo(loopTo);
  });

  it("walks the jump's air pieces back and forth while the updraft bobs the Character", () => {
    const frames = ride(8);
    const held = frames.filter((f) => f.nowMs > 2000 && f.nowMs < 8000).map((f) => f.playhead!);
    expect(Math.min(...held)).toBeLessThan(timeline.apex - 0.1);
    expect(Math.max(...held)).toBeGreaterThan(timeline.apex + 0.1);
    for (const playhead of held) {
      expect(playhead).toBeGreaterThanOrEqual(loopFrom - 1e-9);
      expect(playhead).toBeLessThanOrEqual(loopTo + 1e-9);
    }
    // Not a one-way trip: it turns round again and again.
    let turns = 0;
    for (let i = 2; i < held.length; i += 1) {
      if (Math.sign(held[i]! - held[i - 1]!) * Math.sign(held[i - 1]! - held[i - 2]!) < 0) turns += 1;
    }
    expect(turns).toBeGreaterThanOrEqual(4);
  });

  it("finishes the push-off at the ordinary pace before the loop takes over", () => {
    const frames = ride(8);
    const pushOff = frames.filter((f) => !f.grounded && f.playhead !== null && f.playhead < timeline.liftoff);
    expect(pushOff[0]!.playhead).toBe(0);
    for (let i = 1; i < pushOff.length; i += 1) expect(pushOff[i]!.playhead!).toBeGreaterThan(pushOff[i - 1]!.playhead!);
  });

  it("stays Floating through the bob over the column's top, and draws the overlay in full", () => {
    const sequences = new JumpSequences();
    const frames = ride(8, sequences);
    const aboveTheTop = frames.filter((f) => f.nowMs > 1500 && f.nowMs < 8000 && !f.inUpdraft);
    expect(aboveTheTop.length).toBeGreaterThan(0);

    const again = new JumpSequences();
    const weights: number[] = [];
    const floating: boolean[] = [];
    for (const frame of frames.filter((f) => f.nowMs < 8000)) {
      again.advance("a", frame, timeline);
      if (frame.nowMs > 1500 && !frame.inUpdraft) floating.push(again.isFloating("a"));
      weights.push(again.floatWeight("a"));
    }
    expect(floating.every(Boolean)).toBe(true);
    expect(Math.max(...weights)).toBe(1);
  });

  it("lets go after a long enough stretch out of every updraft, then falls on forward-only", () => {
    const sequences = new JumpSequences();
    const air = (verticalVelocity: number, nowMs: number, inUpdraft: boolean): JumpFrame => ({
      grounded: false, verticalVelocity, height: 20 - nowMs / 100, moving: false, deltaSeconds: DT, nowMs, inUpdraft,
    });
    let nowMs = 0;
    for (; nowMs < 1000; nowMs += 16) sequences.advance("a", air(0, nowMs, true), timeline);
    // The latch counts from the last frame still inside.
    const lastInside = nowMs - 16;
    let last = -Infinity;
    let speed = 0;
    for (; nowMs < lastInside + 2500; nowMs += 16) {
      speed += GRAVITY_Y * DT;
      const playhead = sequences.advance("a", air(speed, nowMs, false), timeline)!;
      if (nowMs - lastInside <= FLOAT_RELEASE_MS) {
        expect(sequences.isFloating("a")).toBe(true);
      } else {
        expect(sequences.isFloating("a")).toBe(false);
        expect(playhead).toBeGreaterThanOrEqual(last);
        last = playhead;
      }
    }
    expect(sequences.floatWeight("a")).toBe(0);
  });

  it("keeps a short drift-out fall Floating until the feet touch down, as the prototype drew it", () => {
    const sequences = new JumpSequences();
    const frames = ride(4, sequences);
    const outInTheAir = frames.filter((f) => f.nowMs > 4100 && !f.grounded && !f.inUpdraft);
    expect(outInTheAir.length).toBeGreaterThan(0);
    expect(outInTheAir.at(-1)!.nowMs - 4000).toBeLessThan(FLOAT_RELEASE_MS);
    expect(sequences.isFloating("a")).toBe(false);
    expect(frames.at(-1)!.grounded).toBe(true);
  });

  it("ends a Float the moment the feet touch down, and fades its overlay out under the landing", () => {
    const sequences = new JumpSequences();
    const air = (inUpdraft: boolean, nowMs: number, grounded = false): JumpFrame => ({
      grounded, verticalVelocity: grounded ? 0 : -2, height: 1, moving: false, deltaSeconds: DT, nowMs, inUpdraft,
    });
    for (let i = 0; i < 60; i += 1) sequences.advance("a", air(true, i * 16), timeline);
    expect(sequences.isFloating("a")).toBe(true);
    const before = sequences.floatWeight("a");
    sequences.advance("a", air(true, 1000, true), timeline);
    expect(sequences.isFloating("a")).toBe(false);
    expect(sequences.floatWeight("a")).toBeLessThan(before);
  });

  it("never starts over on the updraft's own speed swings", () => {
    const sequences = new JumpSequences();
    const air = (verticalVelocity: number, nowMs: number): JumpFrame => ({
      grounded: false, verticalVelocity, height: 3, moving: false, deltaSeconds: DT, nowMs, inUpdraft: true,
    });
    sequences.advance("a", air(-8, 0), timeline);
    for (let i = 1; i < 30; i += 1) sequences.advance("a", air(-8, i * 16), timeline);
    // A kick as big as a launch pad's, but Floating: the loop carries on.
    expect(sequences.advance("a", air(8, 500), timeline)).toBeGreaterThan(timeline.liftoff);
  });
});
