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
  lastInputTick?: number;
  ragdollEpoch?: number;
  ragdollCause?: RagdollCause;
  phaseStartTick?: number;
  bones?: BoneSnapshot[];
}

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
  lastInputTick: fields.lastInputTick ?? 0,
  ragdollEpoch: fields.ragdollEpoch ?? 0,
  ragdollCause: fields.ragdollCause ?? "Fall",
  phaseStartTick: fields.phaseStartTick ?? 0,
  bones: fields.bones ?? [],
});
