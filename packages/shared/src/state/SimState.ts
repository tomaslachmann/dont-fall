import type { Vec3 } from "../math/vec3.js";
import type { CharacterMotionState } from "../simulation/CharacterStateMachine.js";
import type { PropSnapshot } from "../simulation/Prop.js";
import type { BoneSnapshot } from "../simulation/ragdollSkeleton.js";

export type { CharacterMotionState, BoneSnapshot, PropSnapshot };

/**
 * Why a Character was knocked down (ADR 0023). Carried so the client can play
 * cause-specific one-shot effects (camera kick, hit-react, impact SFX). 2 bits
 * on the wire once binary encoding lands — a fifth cause is a protocol-version
 * change (known limitation).
 */
export type RagdollCause = "Bump" | "Fall" | "DashWall" | "Spinner";

export interface CharacterSnapshot {
  /** The point the camera follows: capsule centre while upright, pelvis while ragdolling. */
  position: Vec3;
  /** Capsule velocity (units/s) — carried so a reconciling client can restore it as a replay base (ticket 05). */
  velocity: Vec3;
  /** Whether the character controller reported ground contact last tick. */
  grounded: boolean;
  motionState: CharacterMotionState;
  /** Index of the last Checkpoint reached, or `null` if only the spawn point is set. */
  checkpointIndex: number | null;
  /** How many times this Character has Fallen and Respawned. */
  fallCount: number;
  /**
   * Monotonic count of Respawn teleports (ADR 0023, Q9). The renderer holds the
   * last value it saw per Character and snaps — no interpolation — when it
   * changes. A one-tick boolean was lost whenever the interpolation buffer
   * skipped or coalesced the exact respawn tick.
   */
  respawnCount: number;
  /** Milliseconds left on the Dash cooldown; 0 means Dash is ready. */
  dashCooldownMs: number;
  /** Whether a Dash burst is currently playing out (as opposed to merely on cooldown). */
  dashing: boolean;
  /** Current horizontal speed (units/s) contributed by an active Dash burst; 0 when not dashing. */
  dashSpeed: number;
  /**
   * Rises every time a speed/slow pad fires (M3.7 ticket 01, ADR 0035) — the
   * Epoch idiom (CONTEXT.md), same as {@link ragdollEpoch}/{@link respawnCount}.
   * Not restored during reconciliation: like `ragdollEpoch`, it's a pure
   * function of this Character's own local trigger detection, which
   * re-derives the same count independently on both sides as long as they
   * agree on position.
   */
  speedPadEpoch: number;
  /**
   * Ms remaining until the currently-active pad effect (if any) has fully
   * faded back to neutral; 0 when no effect is active. Mirrors
   * `dashCooldownMs` — a reconciling client restores its `SpeedPadController`
   * from this rather than re-deriving it, exactly like
   * `DashController.restoreCooldownMs`.
   */
  speedPadMsLeft: number;
  /**
   * The peak multiplier the currently-active pad effect is holding/fading
   * from. Meaningless whenever `speedPadMsLeft` is 0, but always carries the
   * last one latched — needed alongside `speedPadMsLeft` to reconstruct the
   * fade curve exactly on reconciliation (the remaining time alone can't
   * distinguish a speed pad's peak from a slow pad's).
   */
  speedPadCapMultiplier: number;
  /**
   * Rises every time a launch pad fires (M3.7 ticket 02) — the Epoch idiom,
   * same as {@link speedPadEpoch}. Not restored during reconciliation, for
   * the same reason `speedPadEpoch` isn't: a pure function of this
   * Character's own local trigger detection, re-derived independently on
   * both sides as long as they agree on position. A launch pad has no
   * decay curve alongside it (unlike `speedPadMsLeft`/`speedPadCapMultiplier`)
   * — its whole effect already lives in the ordinary `velocity` field.
   */
  launchPadEpoch: number;
  /**
   * The highest `InputMessage.tick` the server had applied for this Character
   * as of this snapshot — the reconciliation acknowledgement (ticket 05). 0
   * before any input has arrived. Only meaningful to the client that owns this
   * Character; every other client ignores it.
   */
  lastInputTick: number;
  /**
   * Rises on every entry to `Ragdoll` (ADR 0023). "This is a new down episode"
   * — the client applies a snapshot-delivered one-shot effect iff
   * `ragdollEpoch > lastAppliedEpoch`, and the prediction-tick guard uses it to
   * tell a fresh server knockdown from a stale echo.
   */
  ragdollEpoch: number;
  /** Why the current / most recent knockdown happened (ADR 0023). */
  ragdollCause: RagdollCause;
  /**
   * The sim tick the current `motionState` phase began. The client derives the
   * GettingUp blend from it locally (anchor-tick + local derivation, the
   * `spinnerAngleAt` pattern) rather than the server sending a progress float.
   */
  phaseStartTick: number;
  /**
   * Per-bone transforms while `motionState` is `Ragdoll` or `GettingUp`, in
   * `RAGDOLL_BONES` order; empty otherwise (the renderer draws the capsule).
   */
  bones: BoneSnapshot[];
}

/**
 * The observable state of the world at one tick — a plain, fully serialisable
 * POJO. It is the network snapshot and the interpolation source, and it holds no
 * Rapier handles (ADR 0009).
 */
export interface SimState {
  tick: number;
  /** Every Character in the Match, keyed by an ID assigned when it was added (ticket 01). */
  characters: Record<string, CharacterSnapshot>;
  /**
   * Per-Prop pose, in the same order every tick (ticket 06). A Spinner's pose
   * is not carried here — it is a pure function of `tick`, so the renderer
   * recomputes it directly instead (`spinnerAngleAt`).
   */
  props: PropSnapshot[];
}

export interface CharacterSnapshotFields {
  position: Vec3;
  velocity?: Vec3;
  grounded?: boolean;
  motionState?: CharacterMotionState;
  checkpointIndex?: number | null;
  fallCount?: number;
  respawnCount?: number;
  dashCooldownMs?: number;
  dashing?: boolean;
  dashSpeed?: number;
  speedPadEpoch?: number;
  speedPadMsLeft?: number;
  speedPadCapMultiplier?: number;
  launchPadEpoch?: number;
  lastInputTick?: number;
  ragdollEpoch?: number;
  ragdollCause?: RagdollCause;
  phaseStartTick?: number;
  bones?: BoneSnapshot[];
}

/**
 * The exact slice of a `CharacterSnapshot` a reconciliation needs (ticket 05;
 * `speedPad*` added M3.7 ticket 01) — one shared alias rather than the same
 * field-name union hand-typed twice (`RapierSimulation.reconcileCharacter`
 * and `CharacterController.reconcileTo`, code review), where a future
 * reconciliation-relevant field could easily be added to only one of the two
 * and surface as a confusing type error (or a silently-defaulted runtime
 * value) far from the actual edit.
 */
export type ReconcileBase = Pick<
  CharacterSnapshot,
  "position" | "velocity" | "grounded" | "motionState" | "dashCooldownMs" | "dashing" | "speedPadMsLeft" | "speedPadCapMultiplier"
>;

export const characterSnapshot = (fields: CharacterSnapshotFields): CharacterSnapshot => ({
  position: { ...fields.position },
  velocity: fields.velocity ? { ...fields.velocity } : { x: 0, y: 0, z: 0 },
  grounded: fields.grounded ?? false,
  motionState: fields.motionState ?? "Controlled",
  checkpointIndex: fields.checkpointIndex ?? null,
  fallCount: fields.fallCount ?? 0,
  respawnCount: fields.respawnCount ?? 0,
  dashCooldownMs: fields.dashCooldownMs ?? 0,
  dashing: fields.dashing ?? false,
  dashSpeed: fields.dashSpeed ?? 0,
  speedPadEpoch: fields.speedPadEpoch ?? 0,
  speedPadMsLeft: fields.speedPadMsLeft ?? 0,
  speedPadCapMultiplier: fields.speedPadCapMultiplier ?? 1,
  launchPadEpoch: fields.launchPadEpoch ?? 0,
  lastInputTick: fields.lastInputTick ?? 0,
  ragdollEpoch: fields.ragdollEpoch ?? 0,
  ragdollCause: fields.ragdollCause ?? "Fall",
  phaseStartTick: fields.phaseStartTick ?? 0,
  bones: fields.bones ?? [],
});
