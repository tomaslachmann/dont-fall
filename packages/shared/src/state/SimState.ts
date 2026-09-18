import type { Vec3 } from "../math/vec3.js";
import type { CharacterMotionState } from "../simulation/CharacterStateMachine.js";
import type { PropSnapshot } from "../simulation/Prop.js";
import type { BoneSnapshot } from "../simulation/ragdollSkeleton.js";

export type { CharacterMotionState, BoneSnapshot, PropSnapshot };

/**
 * Why a Character was knocked down (ADR 0023). Carried so the client can play
 * cause-specific one-shot effects (camera kick, hit-react, impact SFX).
 * `"WallImpact"` (M3.7 ticket 03, ADR 0037 — renamed from `"DashWall"`): any
 * Character moving fast enough into a near-vertical surface, whatever gave
 * it the speed — Dash is one contributor among several (a bounce, a launch
 * pad, an updraft), never a separate rule of its own. `"Disconnect"` (M5
 * ticket 04): a mid-Round drop, distinct from `"Fall"` since nothing fell —
 * plain JSON today, so a fifth value costs nothing; needs 3 bits instead of
 * 2 whenever binary encoding lands. `"Hit"` (M6 ticket 03): a landed swing —
 * distinct from `"Bump"` even though both feed the identical Impact
 * pipeline, since one was thrown on purpose and the other wasn't.
 *
 * ADR 0104: `"Hurl"` — thrown out of a Spin, or hit by a body that was (swung
 * or flying); `"Grab"` — let go of while Limp, or carried until the grabber's
 * window ran out; `"Dizzy"` — a grabber that Spun for too long.
 */
export type RagdollCause =
  | "Bump"
  | "Fall"
  | "WallImpact"
  | "Spinner"
  | "Obstacle"
  | "Disconnect"
  | "Hit"
  | "Slip"
  | "Hurl"
  | "Grab"
  | "Dizzy";

/**
 * Which part of a hold a Held Character is in (ADR 0104): its Struggle, which
 * it can still win, or Limp — lost, or grabbed already down.
 */
export type HeldPhase = "struggle" | "limp";

/**
 * The knockdowns another Player caused (ADR 0093) — a swing that landed, or
 * running someone down. Only these throw the body
 * ({@link KNOCKDOWN_LAUNCH_SCALE}); scenery drops you where it caught you.
 * A set rather than a boolean on the cause so the one place that decides
 * "was this a Player" is findable from either side of it.
 */
export const THROWING_RAGDOLL_CAUSES: ReadonlySet<RagdollCause> = new Set<RagdollCause>(["Hit", "Bump", "Hurl"]);

/**
 * The Impacts that shove a Character which stays on its feet (ADR 0093) — a
 * swing that landed and nothing else.
 *
 * Deliberately narrower than {@link THROWING_RAGDOLL_CAUSES}. A Bump and a
 * Moving Segment apply an Impact on *every* tick of contact, and the
 * knockdown they cause depends on closing speed, so shoving the target on the
 * first light touch pushes it out of the harder contact that was coming — a
 * Dash into someone stopped knocking them down at all, and a spinning bar
 * stopped hitting harder at its rim. A Hit is a single event with no
 * follow-up to spoil, which is exactly why it is the one that shoves.
 *
 * A swung or hurled body (ADR 0104) is one too: it counts once per pass of the
 * circle or per flight, never once per tick of contact.
 */
export const SHOVING_IMPACT_CAUSES: ReadonlySet<RagdollCause> = new Set<RagdollCause>(["Hit", "Hurl"]);

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
  /** Milliseconds left on the Hit cooldown (M6 ticket 03); 0 means a swing is ready. */
  hitCooldownMs: number;
  /**
   * Ms charged so far on an in-progress Hit hold (M6.1: hold-to-charge); 0
   * while not charging. Restored on reconciliation exactly like
   * `dashCooldownMs`/`dashing` — a charge is a pure function of held inputs,
   * but a reconciling client's own runahead prediction can hold more (or
   * fewer) charged ticks than the acked tick actually had, so the replay
   * needs the server's own count to continue from, not whatever the client's
   * prediction already accumulated past it.
   */
  hitChargeMs: number;
  /** Milliseconds left on the Grab cooldown (M6 ticket 04); 0 means a grab is ready. Counts from when a hold this Character initiated last ended, not from when it started. */
  grabCooldownMs: number;
  /**
   * The id of whoever this Character is currently grabbing, or `null` (M6.1)
   * — drives the renderer's own arm-reach pose. Cross-Character, authoritative
   * state only `RapierSimulation` can resolve, never predicted locally (Grab
   * itself is authoritative-only) — not in `ReconcileBase` for the same
   * reason `hitReactEpoch` isn't: there is no local prediction of it to
   * correct.
   */
  grabbingId: string | null;
  /**
   * The id of whoever is currently grabbing this Character, or `null`
   * (M6.1) — the reverse of {@link grabbingId}. Lets a client tell "am I
   * involved in a hold at all, as either role," which is what locks this
   * Character's own rendered facing/orientation to the server's frozen
   * value instead of steering it from movement input. Same cross-Character,
   * authoritative-only, not-in-`ReconcileBase` treatment as `grabbingId`.
   */
  heldByGrabberId: string | null;
  /**
   * Which part of its hold this Character is in, or `null` while nobody holds
   * it (ADR 0104). Authoritative-only, like {@link heldByGrabberId}.
   */
  heldPhase: HeldPhase | null;
  /**
   * The Tick the current part of this Character's hold runs out — its
   * Struggle's window, or its grabber's Limp window — or `null` while nobody
   * holds it (ADR 0104). The anchor-tick idiom (`phaseStartTick`): a client
   * derives the time left itself instead of the server sending a countdown.
   */
  holdEndsTick: number | null;
  /**
   * How full this Character's escape meter is, 0..1 (ADR 0104) — the
   * Struggle. Predicted by its own client from its own inputs and restored
   * from here on a reconcile, like `hitChargeMs`, so the meter answers a
   * wiggle at once instead of a round trip later. 0 while not Held.
   */
  escapeProgress: number;
  /**
   * The direction, as a yaw, of this Character's last non-zero movement
   * input while Held, or `null` (ADR 0104) — what the next input has to
   * reverse to count as a wiggle. On the wire only so a reconcile's replay
   * judges its first input exactly as the server did.
   */
  lastWiggleYaw: number | null;
  /**
   * How long (ms) this Character has been Spinning the Character it holds, 0
   * while not (ADR 0104). The wind-up, and with `facing` the whole Spin: its
   * angle is a pure function of this, so a reconcile restores both and the
   * replay turns on from exactly where the server was.
   */
  spinMs: number;
  /**
   * Rises every time a launch pad fires (M3.7 ticket 02) — the Epoch idiom
   * (CONTEXT.md), same as {@link ragdollEpoch}. Not restored during
   * reconciliation: a pure function of this Character's own local trigger
   * detection, re-derived independently on both sides as long as they agree
   * on position — its whole effect already lives in the ordinary `velocity`
   * field.
   */
  launchPadEpoch: number;
  /**
   * World-space yaw in radians this Character is currently facing (M6, ADR
   * 0045) — where the owning client's body is turned (ADR 0085), mirrored
   * onto the Snapshot so every other client can orient its rendered model
   * and Hit/Grab can target "the Character just ahead of you." Not restored
   * during reconciliation (see `ReconcileBase`): it's an input mirror, not
   * simulation-owned state, so a correction's own replay re-derives it from
   * the replayed inputs' own facing.
   */
  facing: number;
  /**
   * The Tick this Character entered a Finish Zone and Qualified, or `null`
   * while it has not (M4 ticket 02, ADR 0039). A pure function of position,
   * derived identically by the server and by a predicting client — on the
   * wire so every client can see who has qualified and in what order, and so
   * a mispredicting client can be corrected (see
   * `RapierSimulation.reconcileCharacter`).
   */
  finishTick: number | null;
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
   * Rises every time this Character's own Hit swing fires (M6 ticket 03) —
   * the Epoch idiom, same as {@link ragdollEpoch}. Whether or not it actually
   * connects with anyone (a separate, cross-Character question): pressing
   * the button and being off cooldown is enough for this to rise, exactly
   * like `speedPadEpoch` cares only about this Character's own trigger, not
   * an outcome. Drives the Punch animation.
   */
  hitEpoch: number;
  /**
   * Rises every time this Character is on the receiving end of a landed Hit
   * (M6 ticket 03) — unlike `hitEpoch`, this is authoritative, cross-Character
   * state only the server (or a full multi-Character sim) can ever actually
   * resolve, never re-derivable locally the way `speedPadEpoch` is. Drives
   * the HitReact animation.
   */
  hitReactEpoch: number;
  /**
   * Rises every time this Character's own grab attempt fires (ADR 0071) — the
   * Grab's counterpart of `hitEpoch`, and just as indifferent to whether the
   * attempt catches anyone (that is `grabbingId`). Drives the reach a Grab at
   * nobody still shows.
   */
  grabEpoch: number;
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
  /**
   * Whether this Character is eliminated (M5 ticket 04, ADR 0042) — marked,
   * never removed, so its entry keeps appearing here with this set, never
   * cleared. Set either by an eliminating Fall (Survival) or directly (a
   * mid-Round disconnect, any Round type). Distinct from `isEliminated`
   * (CONTEXT.md's Results-time "didn't Qualify before the Round ended," true
   * for a Race's own DNFs too): this is the simulation's own, earlier,
   * mid-Round signal that a Character will never move or Qualify again —
   * match authority (`allQualified`) reads it to stop waiting on a
   * Character that can't finish.
   */
  eliminated: boolean;
  /**
   * The Tick {@link eliminated} was set, or `null` while it hasn't been (M7
   * ticket 02) — the Tick elimination was *marked*, not necessarily the Tick
   * of the Fall or disconnect that caused it (a Fall can cross the kill
   * plane one or more Ticks after the shove that doomed it). Lets a
   * Survival Round rank its non-Qualified Characters by how long they
   * lasted, the same way `finishTick` orders the Qualified.
   */
  eliminatedTick: number | null;
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
  hitCooldownMs?: number;
  hitChargeMs?: number;
  grabCooldownMs?: number;
  grabbingId?: string | null;
  heldByGrabberId?: string | null;
  heldPhase?: HeldPhase | null;
  holdEndsTick?: number | null;
  escapeProgress?: number;
  lastWiggleYaw?: number | null;
  spinMs?: number;
  launchPadEpoch?: number;
  facing?: number;
  lastInputTick?: number;
  ragdollEpoch?: number;
  hitEpoch?: number;
  hitReactEpoch?: number;
  grabEpoch?: number;
  ragdollCause?: RagdollCause;
  phaseStartTick?: number;
  bones?: BoneSnapshot[];
  finishTick?: number | null;
  eliminated?: boolean;
  eliminatedTick?: number | null;
}

/**
 * The exact slice of a `CharacterSnapshot` a reconciliation needs (ticket 05)
 * — one shared alias rather than the same
 * field-name union hand-typed twice (`RapierSimulation.reconcileCharacter`
 * and `CharacterController.reconcileTo`, code review), where a future
 * reconciliation-relevant field could easily be added to only one of the two
 * and surface as a confusing type error (or a silently-defaulted runtime
 * value) far from the actual edit.
 */
export type ReconcileBase = Pick<
  CharacterSnapshot,
  | "position"
  | "velocity"
  | "grounded"
  | "motionState"
  | "dashCooldownMs"
  | "dashing"
  | "hitCooldownMs"
  | "hitChargeMs"
  | "grabCooldownMs"
  // ADR 0104: the two halves of a hold a client predicts — its own Struggle,
  // and its own Spin, whose angle is `facing`. Facing is restored always, not
  // only mid-Spin: a grabber's turn is clamped against the tick before, so a
  // replay needs the server's to clamp from.
  | "escapeProgress"
  | "lastWiggleYaw"
  | "spinMs"
  | "facing"
  // M4 ticket 02: Qualification is latched and locks input, so the client
  // must be able to take the server's answer rather than keep its own.
  | "finishTick"
  // M5 ticket 04: Elimination is latched too, and a disconnect-triggered one
  // can never be predicted at all (it never applies to your own Character)
  // — the server's answer wins here for the same reason it does for
  // `finishTick`.
  | "eliminated"
  | "eliminatedTick"
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
  hitCooldownMs: fields.hitCooldownMs ?? 0,
  hitChargeMs: fields.hitChargeMs ?? 0,
  grabCooldownMs: fields.grabCooldownMs ?? 0,
  grabbingId: fields.grabbingId ?? null,
  heldByGrabberId: fields.heldByGrabberId ?? null,
  heldPhase: fields.heldPhase ?? null,
  holdEndsTick: fields.holdEndsTick ?? null,
  escapeProgress: fields.escapeProgress ?? 0,
  lastWiggleYaw: fields.lastWiggleYaw ?? null,
  spinMs: fields.spinMs ?? 0,
  launchPadEpoch: fields.launchPadEpoch ?? 0,
  facing: fields.facing ?? 0,
  lastInputTick: fields.lastInputTick ?? 0,
  ragdollEpoch: fields.ragdollEpoch ?? 0,
  hitEpoch: fields.hitEpoch ?? 0,
  hitReactEpoch: fields.hitReactEpoch ?? 0,
  grabEpoch: fields.grabEpoch ?? 0,
  ragdollCause: fields.ragdollCause ?? "Fall",
  phaseStartTick: fields.phaseStartTick ?? 0,
  bones: fields.bones ?? [],
  finishTick: fields.finishTick ?? null,
  eliminated: fields.eliminated ?? false,
  eliminatedTick: fields.eliminatedTick ?? null,
});
