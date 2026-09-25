import { GRAB_TURN_SPEED_MULTIPLIER, PROP_LIFT_SPEEDUP, PROP_TOSS_TAP_MS, propCarryTurn, type HeldPhase } from "@dont-fall/shared";
import type * as THREE from "three";
import { clipPoseInSequence, lastClipPose, type CharacterActions, type ClipPose } from "./characterModel.js";

/**
 * What a Character is doing about a Grab this frame — the two ends of a hold,
 * plus everybody else.
 *
 * Both fields are already replicated (M6.1): `grabbingId` names whoever this
 * Character is holding, `heldByGrabberId` whoever is holding it. No new state
 * on the wire, the same rule the Spring squash and the bounce sheet follow.
 */
export type GrabRole = "grabbing" | "held" | "free";

export const grabRoleOf = (
  grabbingId: string | null,
  heldByGrabberId: string | null,
  carryingProp: number | null = null,
  lifting = false,
): GrabRole => (grabbingId || carryingProp !== null || lifting ? "grabbing" : heldByGrabberId ? "held" : "free");

/**
 * What a Prop's carrier is doing with it this frame (ADR 0128), read off
 * state the client already has: the Lift and the Toss's wind-up from their
 * replicated clocks, a Spin from `spinMs`, walking from the Character's own
 * speed.
 */
export interface PropCarryFrame {
  /** Whether the hold is a Prop's — Lifting one, or carrying it. */
  prop: boolean;
  /** How far into its Lift, in ms, or `null`. */
  liftMs: number | null;
  /** How far into a Toss's wind-up, in ms, or `null`. */
  tossMs: number | null;
  /** Spinning it, past a tap: held at arm's length, as a Character is. */
  spinning: boolean;
  /** Walking with it, on the ground. */
  walking: boolean;
}

/** Holding no Prop. */
export const NO_PROP_CARRY: PropCarryFrame = { prop: false, liftMs: null, tossMs: null, spinning: false, walking: false };

/** A Character's {@link PropCarryFrame}, from its row and whether it is walking. */
export const propCarryOf = (
  row: { carryingProp: number | null; liftMs: number | null; tossMs: number | null; spinMs: number },
  walking: boolean,
): PropCarryFrame =>
  row.carryingProp === null && row.liftMs === null
    ? { ...NO_PROP_CARRY, walking }
    : { prop: true, liftMs: row.liftMs, tossMs: row.tossMs, spinning: row.spinMs > PROP_TOSS_TAP_MS, walking };

/** The local Character's end of a hold this frame (ADR 0104), as its Stage draws it. */
export interface LocalHold {
  role: GrabRole;
  /** Which part of the hold it is in, when held: kicking in its Struggle, or Limp. */
  phase: HeldPhase | null;
  /**
   * The facing the body is pinned to this frame, or `null` to turn it from
   * input as usual: its grabber's side of the hold while Held (the server's),
   * or the Spin's while Spinning (the prediction's) — a body neither of which
   * its own Player turns.
   */
  pinnedFacing: number | null;
  /** How much of its usual turn the body keeps: less carrying a Character (ADR 0104), less the heavier a carried Prop (ADR 0125), none while Lifting or winding up a Toss (ADR 0128). */
  turnScale: number;
  /** What it is doing with a Prop, if it holds one (ADR 0128). */
  carry: PropCarryFrame;
}

/** Nobody holds anybody. */
export const NO_HOLD: LocalHold = { role: "free", phase: null, pinnedFacing: null, turnScale: 1, carry: NO_PROP_CARRY };

/**
 * The local Character's {@link LocalHold}, from the two places it is known
 * (ADR 0104): whether it is in a hold at all is the server's to say — `server`
 * is its own row on the interpolated server world — while a Spin is predicted,
 * so the body turns on the press and not a round trip later.
 */
export const localHoldOf = (
  server:
    | {
        grabbingId: string | null;
        carryingProp: number | null;
        heldByGrabberId: string | null;
        heldPhase: HeldPhase | null;
        facing: number;
        liftMs: number | null;
        tossMs: number | null;
      }
    | undefined,
  predicted: { spinMs: number; facing: number; tossMs: number | null; walking: boolean },
  /** The mass of the Prop the server says this Character carries, if it carries one (ADR 0125). */
  carriedMass: number | null = null,
): LocalHold => {
  if (!server) return NO_HOLD;
  const role = grabRoleOf(server.grabbingId, server.heldByGrabberId, server.carryingProp, server.liftMs !== null);
  if (role === "held") return { role, phase: server.heldPhase, pinnedFacing: server.facing, turnScale: 1, carry: NO_PROP_CARRY };
  // ADR 0128: the Lift and the Toss are drawn from the server's clock, where
  // the Prop is; the Spin, as ever, from the prediction's.
  const carry = propCarryOf({ ...server, spinMs: predicted.spinMs }, predicted.walking);
  // Stood still by the prediction the moment it winds up, not when the server says so.
  const locked = server.liftMs !== null || predicted.tossMs !== null;
  const turnScale =
    role === "free" ? 1 : locked ? 0 : carriedMass === null ? GRAB_TURN_SPEED_MULTIPLIER : propCarryTurn(carriedMass);
  return { role, phase: null, pinnedFacing: predicted.spinMs > 0 ? predicted.facing : null, turnScale, carry };
};

const looped = (seconds: number, action: THREE.AnimationAction | null): ClipPose | null =>
  action ? { action, time: seconds % action.getClip().duration } : null;

/**
 * The hold, as the rig authors it (ADR 0071, ADR 0104): reach out, then hold
 * at arm's length for as long as it lasts — `Grab_HoldOut` begins on
 * `Grab_Reach`'s exact last frame, so nothing sits between them. A pure
 * function of how long the hold has been going, not a state machine anyone
 * has to keep in sync. A rig with no hold loop rests on the reach's last
 * frame.
 *
 * Replaces the procedural arm-aiming of M6.1, which existed only because the
 * old rig had no Grab clip at all: it pointed the upper arms at the other
 * Character every frame. The authored hold does not aim, and does not need
 * to — the held body is carried straight ahead of its grabber, facing it
 * (ADR 0104), wherever the grabber turns.
 */
export const grabHoldPoseAt = (seconds: number, actions: CharacterActions): ClipPose | null => {
  const lead = [actions.grabReach];
  const leadSeconds = lead.reduce((sum, action) => sum + (action?.getClip().duration ?? 0), 0);
  return clipPoseInSequence(seconds, lead) ?? looped(seconds - leadSeconds, actions.grabHold) ?? lastClipPose(lead);
};

/** Being held: the struggle loop, its own on the ground and in the air — legs kicking at nothing. */
export const strugglePoseAt = (seconds: number, grounded: boolean, actions: CharacterActions): ClipPose | null =>
  looped(seconds, (grounded ? actions.struggleHeld : actions.struggleAir) ?? actions.struggleHeld);

/**
 * Limp in a grabber's hands (ADR 0104): the rig has no clip for it, so the
 * body goes down the way a knockdown does — backwards — and hangs on that
 * clip's last frame for as long as it is carried.
 */
export const limpPoseAt = (seconds: number, actions: CharacterActions): ClipPose | null =>
  clipPoseInSequence(seconds, [actions.ko.B]) ?? lastClipPose([actions.ko.B]);

/**
 * Carrying a Prop (ADR 0128), as `BLIP_Carry_v1` authors it: the Lift is
 * `Pickup_Ground` sped up, from the replicated start; the Toss is
 * `Throw_Item` up to its release; a Spin holds at arm's length as it always
 * has; walking is `Carry_Walk`; and anything else is `Pickup_Ground`'s last
 * frame, the hold every carry clip starts from. `walkSeconds` is how long
 * the current walk has been going, `holdSeconds` how long the hold has.
 */
export const propCarryPoseAt = (
  carry: PropCarryFrame,
  walkSeconds: number,
  holdSeconds: number,
  actions: CharacterActions,
): ClipPose | null => {
  const { pickup, throwItem } = actions;
  if (carry.liftMs !== null && pickup) {
    return { action: pickup, time: Math.min(pickup.getClip().duration, (carry.liftMs / 1000) * PROP_LIFT_SPEEDUP) };
  }
  if (carry.tossMs !== null && throwItem) return { action: throwItem, time: carry.tossMs / 1000 };
  if (carry.spinning) return looped(holdSeconds, actions.grabHold) ?? grabHoldPoseAt(holdSeconds, actions);
  if (carry.walking && actions.carryWalk) return looped(walkSeconds, actions.carryWalk);
  return lastClipPose([pickup]) ?? grabHoldPoseAt(holdSeconds, actions);
};

/**
 * A grab attempt that caught nobody: the reach, then the arms coming back in
 * (`Grab_Reach` → `Grab_DropOut`, the rig's own path out of a reach at arm's
 * length). `null` once it has played.
 */
export const grabAttemptPoseAt = (seconds: number, actions: CharacterActions): ClipPose | null =>
  clipPoseInSequence(seconds, [actions.grabReach, actions.grabDropOut]);

/**
 * The end of a hold, on the grabber (ADR 0104): the arms come back in from
 * arm's length — `Grab_DropOut` starts on the hold loop's exact pose, so a
 * let-go or a Hurl flows out of the hold the way the reach flowed in, instead
 * of snapping from the hold straight into a locomotion crossfade. `null` once
 * it has played.
 */
export const grabReleasePoseAt = (seconds: number, actions: CharacterActions): ClipPose | null =>
  clipPoseInSequence(seconds, [actions.grabDropOut]);

/**
 * The rest of a Toss once the Prop has left the hands (ADR 0128): `Throw_Item`
 * carries on from where the wind-up was last seen and ends in `Idle`'s first
 * frame. Walking cuts it short — the follow-through is a standing one.
 */
const tossTailPoseAt = (
  tossAt: { seconds: number; atMs: number } | null,
  nowMs: number,
  walking: boolean,
  actions: CharacterActions,
): ClipPose | null => {
  if (!tossAt || walking) return null;
  return clipPoseInSequence(tossAt.seconds + (nowMs - tossAt.atMs) / 1000, [actions.throwItem]);
};

interface GrabClock {
  /** The last `grabEpoch` seen. */
  epoch: number;
  role: GrabRole;
  /** When what is playing now started — `null` when nothing is. */
  startedAtMs: number | null;
  /** When a held body went Limp (ADR 0104) — `null` while it is not. */
  limpSinceMs: number | null;
  /**
   * What "free" is playing: the tail out of a hold — the arms coming back in,
   * or the rest of a Toss (ADR 0128) — rather than an attempt's reach.
   */
  releasing: "drop" | "toss" | null;
  /** The last Toss wind-up time seen while holding, and when — where its tail carries on from. */
  tossAt: { seconds: number; atMs: number } | null;
  /** When the current walk with a Prop started, `null` while not walking. */
  walkSinceMs: number | null;
}

/**
 * Every grab pose a Character can be in, keyed by id like the renderer's
 * other per-Character bookkeeping (ADR 0071): the hold, the struggle, the
 * attempt that caught nobody, and the way out of a hold that ended — the
 * grabber's arms come back in rather than snapping to locomotion. A grabber
 * that goes DOWN mid-hold (dizzy) plays no tail: the knockdown owns the whole
 * body, and the caller's down branch calls {@link GrabAnimations.forget} so a
 * stale "was grabbing" doesn't fire the tail after the get-up.
 *
 * That last one did not exist at first. The hold was the only thing drawn, so
 * a Grab at empty air showed nothing at all, whether in a match or in
 * free-roam, where there is never anybody to catch (bug report 2026-09-16).
 * `grabEpoch` rises on every attempt, and this is its only reader.
 *
 * All three share one clock per Character because they hand over to one
 * another. The local Character's attempt is predicted and plays at once, but
 * whether it caught anyone is the server's to say, a round trip later. By then
 * the reach is already under way, so a hold that grows out of an attempt keeps
 * that attempt's clock and carries on from the same frame rather than
 * reaching a second time.
 */
export class GrabAnimations {
  private readonly clocks = new Map<string, GrabClock>();

  /**
   * The grab pose to draw for `id` this frame, or `null`. Call it every frame,
   * with `pinClipPose` on whatever it returns. The first call for an id only
   * records its `grabEpoch`: joining a match whose Characters have grabbed
   * before plays nothing.
   */
  pose(
    id: string,
    role: GrabRole,
    grabEpoch: number,
    grounded: boolean,
    nowMs: number,
    actions: CharacterActions,
    limp = false,
    carry: PropCarryFrame = NO_PROP_CARRY,
  ): ClipPose | null {
    let clock = this.clocks.get(id);
    if (!clock) {
      clock = {
        epoch: grabEpoch,
        role,
        startedAtMs: role === "free" ? null : nowMs,
        limpSinceMs: null,
        releasing: null,
        tossAt: null,
        walkSinceMs: null,
      };
      this.clocks.set(id, clock);
    }
    // ADR 0104: a held body that goes Limp collapses from that moment on.
    const isLimp = role === "held" && limp;
    if (!isLimp) clock.limpSinceMs = null;
    else clock.limpSinceMs ??= nowMs;
    const attempted = grabEpoch !== clock.epoch;
    clock.epoch = grabEpoch;

    if (role !== clock.role) {
      const reaching = clock.role === "free" && clock.startedAtMs !== null && clock.releasing === null;
      const continues = role === "grabbing" && reaching && !attempted;
      // A hold that just ended plays its way out (`grabReleasePoseAt`), or a
      // Toss plays on past its release (ADR 0128); a fresh attempt on the
      // same frame outranks either, being a new reach.
      const releasing = role === "free" && clock.role === "grabbing" && !attempted ? (clock.tossAt ? "toss" : "drop") : null;
      clock.startedAtMs = role === "free" ? (releasing ? nowMs : null) : continues ? clock.startedAtMs : nowMs;
      clock.releasing = releasing;
      clock.role = role;
    }
    if (attempted && role === "free") {
      clock.startedAtMs = nowMs;
      clock.releasing = null;
    }
    if (role !== "grabbing" || !carry.prop) clock.walkSinceMs = null;
    if (clock.startedAtMs === null) return null;

    const seconds = (nowMs - clock.startedAtMs) / 1000;
    switch (role) {
      case "grabbing": {
        if (!carry.prop) return grabHoldPoseAt(seconds, actions);
        clock.tossAt = carry.tossMs === null ? null : { seconds: carry.tossMs / 1000, atMs: nowMs };
        clock.walkSinceMs = carry.walking ? (clock.walkSinceMs ?? nowMs) : null;
        const walkSeconds = clock.walkSinceMs === null ? 0 : (nowMs - clock.walkSinceMs) / 1000;
        return propCarryPoseAt(carry, walkSeconds, seconds, actions);
      }
      case "held":
        return clock.limpSinceMs !== null
          ? limpPoseAt((nowMs - clock.limpSinceMs) / 1000, actions)
          : strugglePoseAt(seconds, grounded, actions);
      case "free": {
        const pose =
          clock.releasing === "toss"
            ? tossTailPoseAt(clock.tossAt, nowMs, carry.walking, actions)
            : clock.releasing === "drop"
              ? grabReleasePoseAt(seconds, actions)
              : grabAttemptPoseAt(seconds, actions);
        if (!pose) {
          clock.startedAtMs = null;
          clock.releasing = null;
          clock.tossAt = null;
        }
        return pose;
      }
    }
  }

  forget(id: string): void {
    this.clocks.delete(id);
  }

  reset(): void {
    this.clocks.clear();
  }
}
