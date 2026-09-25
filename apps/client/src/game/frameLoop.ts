import {
  IDLE_INPUTS,
  INITIAL_LEAD_TICKS_MAX,
  INITIAL_LEAD_TICKS_MIN,
  TICK_MS,
  addVec3,
  interpolateState,
  isDownMotionState,
  isEliminated,
  isPlayerDrivenMotionState,
  leadAdjustMs,
  movementDirection,
  phaseLocksInput,
  type CharacterMotionState,
  type PropSnapshot,
  type RenderCharacter,
  type RenderState,
  type SimInputs,
  type SimState,
  type Vec3,
} from "@dont-fall/shared";
import { matchBanner } from "../hud/matchBanner.js";
import { localHoldOf } from "../render/grabAnimation.js";
import { carriedPose, carriedPropPose } from "./carriedPose.js";
import { carriedPropsOf } from "./carriedProps.js";
import type { PredictionLoop } from "../net/predictionLoop.js";
import { graceTicksForRtt } from "../net/propPrediction.js";
import type { SnapshotInterpolator } from "../net/snapshotInterpolation.js";
import { inputPerTick } from "../net/tickInput.js";
import { isMatchSpectator, isSpectating, livingIds, type SpectateSnapshot } from "./spectator.js";
import type { GameSession } from "./session.js";

/**
 * One drawn frame, in order: sample input, advance the prediction, compose
 * what to draw, draw it, aim the camera, speak.
 *
 * Everything here is render-rate. The fixed-timestep half lives in
 * `PredictionLoop` (M4.5 ticket 02) and in the shared step behind it; this
 * file never decides a simulation rule, only what a monitor shows.
 */

/**
 * Cap on the per-frame delta fed to the Character model's animation/facing
 * update. `PredictionLoop.step` already bounds how many sim ticks a stalled
 * frame can catch up on (`MAX_STEPS_PER_FRAME`); this bounds the render-only
 * animation step the same way, so a backgrounded-tab refocus can't snap the
 * facing or jump the clip.
 */
const MAX_ANIMATION_DELTA_MS = 100;

/**
 * Sampled unconditionally — whether it actually drives the Character is the
 * shared step's own call (M5 ticket 01, ADR 0044): the phase goes down to
 * `predictionLoop.step`, and `RapierSimulation.tick` is the one place, on both
 * sides, that decides "may this Character be driven this tick?". So it stops
 * and starts driving on the identical Tick the server does, rather than this
 * client predicting half an RTT of movement the server never simulated.
 *
 * The camera is deliberately untouched by the lock: it stays live through the
 * Countdown, which is what lets a Player look around before the start.
 */
const sampleInput = (session: GameSession): SimInputs => ({
  moveDirection: movementDirection(session.keyboard.movementKeys(), session.world.look.yaw),
  jumpHeld: session.keyboard.jumpHeld(),
  dashHeld: session.keyboard.dashHeld(),
  hitHeld: session.keyboard.hitHeld(),
  grabHeld: session.keyboard.grabHeld(),
  // ADR 0085: where the body is turned, not where the camera looks — so every
  // other client draws this Character the way this Player sees it, and Hit and
  // Grab aim where it is turned. Still a plain angle, never the camera or the
  // model itself (ADR 0009).
  facing: session.world.stage.characterFacing(),
});

/**
 * ADR 0027: seed the prediction tick into the server's own tick space, once,
 * as soon as both estimates are available. Ongoing drift is corrected by the
 * LEAD feedback afterwards — this only needs the right ballpark.
 *
 * Seeded where this frame *starts* on the server's clock, not where it ends:
 * the `step` that follows advances the tick by the frame's whole elapsed time,
 * as on every frame (a clamped stall skips its tick numbers rather than
 * dropping them, ADR 0109). Seeded at the frame's end, a long seeding frame —
 * the game booted, or a Round's Track swapped in, while the tab was hidden —
 * counted twice: after a 10 s one the prediction led the server by 300 ticks
 * too many, the server ignored this Player's input for 20 s, and every
 * Snapshot meanwhile replayed the whole input buffer.
 */
export const seedPredictionTick = (
  predictionLoop: PredictionLoop,
  timeSync: { readonly ready: boolean; readonly rttMs: number },
  serverInterp: Pick<SnapshotInterpolator, "ready" | "estimatedServerTick">,
  now: number,
  elapsedMs: number,
): void => {
  if (predictionLoop.isSeeded || !timeSync.ready || !serverInterp.ready) return;
  const leadTicks = Math.max(
    INITIAL_LEAD_TICKS_MIN,
    Math.min(INITIAL_LEAD_TICKS_MAX, Math.ceil(timeSync.rttMs / 2 / TICK_MS) + 1),
  );
  predictionLoop.seed(serverInterp.estimatedServerTick(now - elapsedMs), leadTicks);
};

/**
 * Refresh the obstacles this client's prediction slides against — other
 * Players' mirror capsules (ADR 0012) and every Prop (ADR 0016) — from the
 * *interpolated* render pose, so an obstacle sits exactly where it is drawn and
 * advances smoothly between snapshots instead of jumping once per snapshot. For
 * a Prop you are pushing, the jump-per-snapshot version read as a sawtooth:
 * predict blocked → snap forward on the next snapshot → predict blocked again.
 */
const pinObstacles = (session: GameSession, serverRender: RenderState | null): void => {
  const { localSim } = session.world;
  if (serverRender) {
    const others: Record<string, Vec3> = {};
    for (const [id, character] of Object.entries(serverRender.characters)) {
      // A Player who is down gets no mirror at all — you run through a floored
      // body rather than snag on a half-buried pelvis-height capsule (the M2
      // simplification, made explicit). Nor does one being carried (ADR
      // 0104): its collider is off on the server too, and a mirror left where
      // the server's past had it would stop a grabber walking into its own
      // hands.
      if (id !== session.myId && isPlayerDrivenMotionState(character.motionState)) others[id] = character.position;
    }
    localSim.syncMirrorCharacters(others);
    localSim.syncPropsToSnapshot(serverRender.props);
  }
  // A Prop the local Character is currently predicting (ADR 0022) is left to
  // simulate freely this frame instead of being pinned; every other Prop stays
  // a pinned obstacle. With no interpolated world yet (buffer underrun) nothing
  // is predicted — the state machine cannot advance without server poses.
  localSim.setPredictedProps(serverRender ? session.net.propPrediction.predictedIndices : []);
};

/** Everything this frame draws, composed once and then handed to the Stage. */
interface DrawnFrame {
  /** The local simulation's own latest state. */
  snapshot: SimState;
  /** That state interpolated toward the previous one by the sub-tick alpha. */
  render: RenderState;
  localAlpha: number;
  /** The local Character as the prediction has it — every gameplay read uses this, never the smoothed one. */
  own: SimState["characters"][string];
  /** Whether the local Character's body is the server's to move right now — down, or Held (ADR 0104) — and so drawn from the server's world. */
  drawnFromServer: boolean;
  /** The local Character on the latest *interpolated server* world, when there is one. */
  serverOwn: RenderCharacter | undefined;
  /** What is actually drawn for the local Character: the smoothed pose, or the server's while down. */
  visual: RenderCharacter;
  remote: Record<string, RenderCharacter>;
  props: PropSnapshot[];
}

/**
 * Whether the local Character is drawn from the interpolated server world this
 * frame instead of from its own prediction. Only a body the server moves —
 * down, or Held (ADR 0104) — ever is, and only once the drawn world shows it
 * so: a knockdown once its ragdoll bones are there, a hold once the drawn
 * world has the Character out of its Player's hands too. The prediction turns
 * Held on the newest Snapshot, and the drawn world trails that by the
 * Interpolation Delay — at every latency, since ADR 0109's playout clock
 * stopped running the buffer dry over the internet — so switching at once drew
 * the caught Character (and aimed its camera) back where the server had it
 * before the catch, for a few frames, before lifting it into the grabber's
 * hands. Until the hold shows, the reconciled prediction is drawn: already
 * where the newest Snapshot carries it, its input dead (`syncOwnHold`), and
 * with no correction offset, as for any body the server moves.
 *
 * The drawn row's own state cannot say when a hold taken on the feet shows:
 * it is the later Snapshot's, so it reads Held over the whole Tick before the
 * one the hold began on, while its position is still lerped up from where the
 * Character stood. Drawn then, the body dropped out of the hands the
 * prediction had just drawn it in, and rose back into them over that Tick. So
 * such a hold waits for the drawn tick (`hold.drawnTick`, the render tick the
 * drawn world was sampled at) to reach the Tick it began on
 * (`hold.heldSinceTick`, {@link heldSinceTickAfter}). A hold taken on a
 * Character already down has none: it was drawn from the server while down, a
 * ragdoll turning into a capsule is a body swap interpolation never blends
 * through, and it stays drawn from there throughout.
 */
export const ownDrawnFromServer = (
  ownMotionState: CharacterMotionState,
  serverOwn: RenderCharacter | undefined,
  hold: { drawnTick: number; heldSinceTick: number | null },
): serverOwn is RenderCharacter => {
  if (serverOwn === undefined || isPlayerDrivenMotionState(ownMotionState)) return false;
  if (isDownMotionState(ownMotionState)) return serverOwn.bones.length > 0;
  if (isPlayerDrivenMotionState(serverOwn.motionState)) return false;
  return !(serverOwn.motionState === "Held" && hold.heldSinceTick !== null && hold.drawnTick < hold.heldSinceTick);
};

/**
 * What `heldSinceTick` — the Tick {@link ownDrawnFromServer} waits for — is
 * after one more Snapshot: the Tick of the first Snapshot to have the local
 * Character Held when the one before had it on its feet, kept while the hold
 * lasts. Null outside a hold, and through a hold taken on a Character already
 * down, which is drawn from the server throughout. Fed every Snapshot in
 * arrival order, so it is the first Held Tick the server sent, whatever the
 * snapshot rate.
 */
export const heldSinceTickAfter = (
  heldSinceTick: number | null,
  previous: CharacterMotionState | undefined,
  current: CharacterMotionState | undefined,
  tick: number,
): number | null => {
  if (current !== "Held") return null;
  if (previous === "Held") return heldSinceTick;
  return previous !== undefined && isPlayerDrivenMotionState(previous) ? tick : null;
};

/** The local simulation's half of a frame, composed before the Prop state machine runs (see the frame loop). */
type LocalFrame = Pick<DrawnFrame, "snapshot" | "render" | "localAlpha">;

const composeDraw = (
  session: GameSession,
  local: LocalFrame,
  serverRender: RenderState | null,
  elapsedMs: number,
  now: number,
): DrawnFrame => {
  const { predictionLoop } = session.world;
  const { snapshot, render } = local;
  const own = snapshot.characters[session.myId]!;

  // While down, draw the local Character exactly like a remote one: from the
  // interpolated server snapshot, not the local prediction (ADR 0015
  // follow-up). `localSim` still runs its own cosmetic ragdoll physics for the
  // ~half-RTT before the first confirming snapshot, but once the server *has*
  // confirmed the knockdown its down-state pose is jitter-free by construction
  // (the same 30 Hz interpolation that makes a remote ragdoll look smooth),
  // where the local one drifts from independent per-machine ragdoll physics
  // that is only nudged back into rough alignment each snapshot
  // (`Ragdoll.snapRootTo`) and not corrected at all while `GettingUp` — a real
  // reported glitch (an off-centre wall hit settles differently on each side,
  // then pops straight when `Controlled` resumes). There is exactly one
  // down-state pose on screen, and it is the server's.
  //
  // A Held body is the same case (ADR 0104): its own client never moves it —
  // the grabber carries it, on the server — so it is drawn from there too.
  // Either way only once the drawn server world agrees (`ownDrawnFromServer`);
  // until then the prediction is drawn, with no correction offset.
  const drawnFromServer = !isPlayerDrivenMotionState(own.motionState);
  const serverOwn = serverRender?.characters[session.myId];
  const fromServer = ownDrawnFromServer(own.motionState, serverOwn, {
    // Asked at the `now` the drawn world was sampled at, which the playout
    // clock answers with the same tick.
    drawnTick: session.net.serverInterp.renderTick(now),
    heldSinceTick: session.net.heldSinceTick,
  });
  const renderCharacter = fromServer ? serverOwn : render.characters[session.myId]!;

  // ADR 0026: decay the local Character's own render-time correction offset one
  // frame, same as a pushed Prop's (ADR 0022). Never carried across a
  // motionState change or while down — the offset only smooths corrections
  // against the interpolated Controlled/Stagger pose.
  predictionLoop.decayCapsuleOffset(Math.min(elapsedMs, MAX_ANIMATION_DELTA_MS), own.motionState, drawnFromServer);
  // Obstacle/mirror sync and every gameplay read use the raw pose (Fiedler:
  // smoothing must never feed back into the sim or anything that drives
  // further simulation). The camera is not one of those — it is a pure
  // rendering leaf — so it follows the same offset-smoothed pose as the drawn
  // mesh: a 2026-09 playtest found the camera visibly jerking on ordinary
  // corrections because it was still fed the raw stream. Harness-confirmed:
  // the raw stream carries the exact same ~20 cm pop this offset was built to
  // eliminate (`predictionRegression.harness.test.ts`, "the CAMERA target").
  const visual: RenderCharacter = drawnFromServer
    ? renderCharacter
    : { ...renderCharacter, position: addVec3(renderCharacter.position, predictionLoop.capsuleErrorOffset) };

  const remote: Record<string, RenderCharacter> = {};
  if (serverRender) {
    for (const [id, character] of Object.entries(serverRender.characters)) {
      if (id !== session.myId) remote[id] = character;
    }
  }
  // ADR 0104: whoever the local Character carries is drawn in its hands as
  // they are drawn — predicted, ahead of the server world it is otherwise
  // drawn from. See `carriedPose`. The facing is the prediction's
  // INTERPOLATED one, never `own.facing` raw: a full Spin turns 18° a tick,
  // and the raw last-tick value would jump the carried body ~35 cm around
  // the circle every 33 ms — the drawn grabber's own yaw is pinned to the
  // same interpolated value (`localHoldOf`), so the pair turns together.
  const carriedId = serverOwn?.grabbingId;
  if (carriedId && remote[carriedId] && serverOwn) {
    remote[carriedId] = carriedPose(remote[carriedId], serverOwn, {
      position: visual.position,
      facing: render.characters[session.myId]!.facing,
    });
  }
  // Props are drawn from the interpolated server snapshot (ADR 0017), except
  // the one the local Character is pushing, which is drawn from the
  // sub-tick-interpolated local pose plus a decaying error offset (ADR 0022).
  // Nothing is drawn until the first snapshot arrives.
  const props: PropSnapshot[] = serverRender
    ? session.net.propPrediction.renderPoses(render.props, serverRender.props)
    : [];
  // ADR 0125: a Prop the local Character carries is drawn in its hands as they
  // are drawn, exactly as a carried Character is above.
  const carriedProp = serverOwn?.carryingProp;
  if (carriedProp !== null && carriedProp !== undefined && props[carriedProp] && serverOwn) {
    props[carriedProp] = carriedPropPose(props[carriedProp]!, serverOwn, {
      position: visual.position,
      facing: render.characters[session.myId]!.facing,
    });
  }

  return { ...local, own, drawnFromServer, serverOwn, visual, remote, props };
};

/** Everything the Stage is told this frame, in the order it must hear it. */
const drawWorld = (session: GameSession, frame: DrawnFrame, input: SimInputs, elapsedMs: number, now: number): void => {
  const { stage } = session.world;
  const { roster, myId } = session;
  const animationDelta = Math.min(elapsedMs, MAX_ANIMATION_DELTA_MS) / 1000;
  const cast = { ...frame.remote, [myId]: frame.visual };

  // ADR 0118: read straight off the prediction, which mirrors the server's
  // floors and carries whatever this client has broken since the last
  // snapshot — so a tile you just put your foot through goes now, not a
  // round trip later.
  stage.applyRenderState({
    character: frame.visual,
    props: frame.props,
    fragile: session.world.localSim.fragileLooks(),
    // ADR 0126: what the newest Snapshot says each Bomb is doing, drawn at the
    // Tick the Props themselves are drawn at.
    bombs: { rows: session.net.latestSnapshot?.bombs ?? [], tick: session.net.serverInterp.renderTick(now) },
    nowMs: now,
  });
  // Body looks ahead of the rigs (M9 ticket 15, ADR 0091) — a rig built this
  // frame already wears its skin (or its color), and the local model follows
  // the own row's bind. Hats the same way (ADR 0083).
  stage.setPlayerColors(new Map(Object.entries(roster.colors)));
  stage.setPlayerNames(new Map(Object.entries(roster.names)));
  // Voice chat names people by Account and the simulation by session id
  // (ADR 0111), so the roster is where the two are turned into each other —
  // before `applyRemoteCharacters`, which is what builds the nameplates.
  stage.setSpeakingPlayers(speakingPlayerIds(session));
  stage.setPlayerSkins(new Map(Object.entries(roster.skins)));
  stage.setLocalLook(roster.colors[myId] ?? null, roster.skins[myId] ?? null);
  stage.setPlayerHats(new Map(Object.entries(roster.hats)));
  stage.setLocalHat(roster.hats[myId] ?? null);
  stage.applyRemoteCharacters(frame.remote, animationDelta, myId, frame.visual.position);
  // The local Character's own Epoch comes from the prediction (ADR 0069): its
  // Spring squashes on the tick it fires, a round trip before the server says
  // so; every other Character's arrives on the snapshot. The bounce sheets
  // answer the same cast (ADR 0070) — everyone standing on them, not only the
  // Player looking at them.
  stage.applySpringSquash(cast, now);
  stage.applyBounceSheets(cast, now);
  // Characters are heard (M14 tickets 05, 06) after the bounce sheets, whose
  // landings are thumps. While down, your own Character is heard from its
  // prediction, not the server's copy drawn then: that copy lags the counters
  // the prediction already raised, and switching between the two would sound a
  // Spring or a Respawn twice. What only the server resolves (a Hit landing on
  // you, a hold) comes from its latest snapshot, the one the prediction was
  // just reconciled to, so a Hit and the Stagger it forces are heard in order.
  const latestOwn = session.net.latestSnapshot?.characters[myId];
  const heardOwn: RenderCharacter = {
    ...(frame.drawnFromServer ? frame.render.characters[myId]! : frame.visual),
    hitReactEpoch: latestOwn?.hitReactEpoch ?? 0,
    grabbingId: latestOwn?.grabbingId ?? null,
    heldByGrabberId: latestOwn?.heldByGrabberId ?? null,
    heldPhase: latestOwn?.heldPhase ?? null,
  };
  stage.applyCharacterSounds({ ...frame.remote, [myId]: heardOwn }, myId, now);
  // ADR 0110: what you hear yourself take, the camera feels.
  stage.applyShake(heardOwn, myId, now);
  // Air columns (ADR 0075) — the flow every Volume on the Track promises, streamed every frame.
  stage.updateAirColumns(now);

  // `frame.own` is `localSim`'s own snapshot, whose Character map only ever
  // holds `myId` (every other Player is a lightweight `MirrorCharacter` for
  // collision, never a second `CharacterController`), so it can never reflect
  // cross-Character authoritative state: Grab and a landed Hit are both only
  // ever resolved against a real second Character. This Character's own swing
  // firing (`hitEpoch`) is a pure function of locally-replayed inputs and stays
  // correct read from it — but `hitReactEpoch`/`grabbingId` need the
  // server-derived value, or the local Player would never see their own
  // HitReact land, and never see their own arms reach while grabbing someone.
  const hitReactEpoch = frame.serverOwn?.hitReactEpoch ?? 0;
  // ADR 0104: whether this Character is in a hold at all is the server's to
  // say; a Spin is predicted, so the body turns on the press. Its facing is
  // the prediction's interpolated one (`frame.render`), not the raw last
  // tick's: pinned yaw bypasses `nextModelYaw`'s easing, so the raw value
  // would step the spinning body 18° every tick instead of turning smoothly.
  const carried = frame.serverOwn?.carryingProp ?? null;
  const moveDirection = phaseLocksInput(session.match.phase) ? IDLE_INPUTS.moveDirection : input.moveDirection;
  const hold = localHoldOf(
    frame.serverOwn,
    {
      spinMs: frame.own.spinMs,
      facing: frame.render.characters[myId]!.facing,
      tossMs: frame.own.tossMs,
      walking: frame.own.grounded && (moveDirection.x !== 0 || moveDirection.z !== 0),
    },
    carried === null ? null : session.world.localSim.propMass(carried),
  );
  stage.updateCharacterAnimation(
    animationDelta,
    // Cosmetic only, not a second lock: the sim already refused to move the
    // Character while locked (M5 ticket 01), so this just picks the idle stance
    // over animating legs toward a `moveDirection` it never walked toward.
    moveDirection,
    frame.own.grounded,
    frame.own.dashing,
    frame.own.dashSpeed,
    frame.own.velocity.y,
    frame.own.hitEpoch,
    hitReactEpoch,
    // Predicted, like `hitEpoch`: the reach starts on the press, and a catch
    // confirmed a round trip later carries on from it.
    frame.own.grabEpoch,
    hold,
  );
  // ADR 0128: every carried Prop in the hands as the rigs were just drawn —
  // remote carriers' and this one's, whose Spin is its own prediction.
  stage.holdCarriedProps(
    carriedPropsOf(
      [
        ...Object.entries(frame.remote).map(([id, rc]) => ({ id, carryingProp: rc.carryingProp, spinMs: rc.spinMs })),
        { id: null, carryingProp: carried, spinMs: frame.own.spinMs },
      ],
      frame.props,
      (index) => session.world.localSim.propGripShape(index),
    ),
    animationDelta,
  );
  // Motion phase is a pure function of the tick and the client can compute it
  // exactly — so render it at the *prediction* tick, matching what the local
  // Character's own collision runs against, not the delayed render tick (ADR
  // 0025), at the same sub-tick alpha the Character itself is drawn at.
  stage.updateMotion(frame.snapshot.tick - 1 + frame.localAlpha, session.world.localSim.motionClock);
};

/** Where the camera looks this frame, and who the shell is told it is watching. */
const aimCamera = (
  session: GameSession,
  frame: DrawnFrame,
  serverRender: RenderState | null,
  elapsedMs: number,
): { spectating: boolean; spectatingNickname: string | undefined } => {
  const { spectate, roster, myId, match } = session;
  const latest = session.net.latestSnapshot;
  // Spectator Mode (M7 ticket 07): while out and the Round is still RUNNING,
  // the camera follows a Character still in it — the same collision-resolved
  // spring arm, aimed at somebody else, not a second camera. The followed pose
  // comes from the interpolated render world (ADR 0025), never a raw snapshot
  // position; who counts as living comes from the authoritative snapshot's own
  // `eliminated` flags. Nobody living (all out on the same Tick, a solo Round)
  // falls back to your own body — always a valid, live target. Input needs no
  // change: an out Character is never stepped (ADR 0042/0044).
  const ownEliminated = latest?.characters[myId]?.eliminated ?? frame.own.eliminated;
  // A mid-Match joiner has no Character in the Round at all (M7 ticket 08) — no
  // elimination, just nothing of their own to aim at — so they follow the field
  // through the same path until a fresh Match seats them.
  const serverHasMe = latest?.characters[myId] !== undefined;
  const mySnap = latest?.characters[myId];
  const ownFinished = mySnap !== undefined && mySnap.finishTick !== null;
  // Ticket 14: a finisher may ask to spectate (the verdict's SPECTATE) — the
  // camera-only half of Spectator Mode, which M7 gated on elimination alone. A
  // finished Character isn't stepped either, so this drives nothing.
  const spectating =
    isSpectating(match.phase, ownEliminated) ||
    isMatchSpectator(match.phase, serverHasMe) ||
    (match.phase === "RUNNING" && spectate.requested && ownFinished);

  // Drained every frame either way, so a cycle key pressed while playing can't
  // bank a stale step for the next time you are out.
  const spectatePresses = session.keyboard.consumeSpectateNext();
  let cameraTarget: Vec3 = frame.visual.position;
  let spectatingNickname: string | undefined;

  if (spectating && serverRender && latest) {
    const living = livingIds(latest.characters, myId);
    spectate.controller.update(living);
    // The shell's inbox, drained like the keyboard's — a bean button names its
    // target, the pills step. Any follow resumes tracking (FREE CAM lasts until
    // someone is followed, however they were picked).
    if (spectate.followRequest !== null) {
      spectate.controller.follow(living, spectate.followRequest);
      spectate.followRequest = null;
      spectate.freeCam = false;
    }
    for (let i = 0; i < spectatePresses + spectate.steps; i += 1) {
      spectate.controller.cycle(living);
      spectate.freeCam = false;
    }
    spectate.steps = 0;
    for (let i = 0; i < spectate.backs; i += 1) {
      spectate.controller.cyclePrev(living);
      spectate.freeCam = false;
    }
    spectate.backs = 0;

    const targetId = spectate.controller.target;
    const followed = targetId === null ? undefined : serverRender.characters[targetId];
    if (targetId !== null && followed) {
      cameraTarget = followed.position;
      spectatingNickname = roster.names[targetId];
    }
    // FREE CAM holds the pose the follow was released from — the shell keeps
    // looking around from there instead of tracking.
    if (!spectate.freeCam) spectate.freeCamPose = null;
    else if (spectate.freeCamPose === null) spectate.freeCamPose = cameraTarget;
    if (spectate.freeCamPose !== null) cameraTarget = spectate.freeCamPose;

    const onSpectate = session.callbacks.onSpectate;
    if (onSpectate) {
      // Everyone still racing but yourself — the out and the finished sit out
      // alike, in cycle order, named off the roster.
      const runners = living
        .filter((id) => latest.characters[id]?.finishTick === null)
        .map((id) => ({ id, nickname: roster.names[id] ?? roster.known.get(id) ?? "Player" }));
      const snapshot: SpectateSnapshot = {
        followingId: targetId,
        followingNickname: targetId === null ? "—" : (roster.names[targetId] ?? roster.known.get(targetId) ?? "Player"),
        // The server's own live Race placement (ADR 0088, 0110); Survival has
        // no mid-Round places, only beans left.
        followedPlace: match.survival || targetId === null ? null : (match.livePlaces?.[targetId] ?? null),
        runners,
        beansLeft: runners.length,
        aliveForMs: Math.floor((match.roundElapsedMs ?? 0) / 1000) * 1000,
        freeCam: spectate.freeCamPose !== null,
      };
      session.gates.spectate.raise(snapshot, onSpectate);
    }
  } else {
    spectate.controller.reset();
    spectate.freeCamPose = null;
    if (session.callbacks.onSpectate) session.gates.spectate.raise(null, session.callbacks.onSpectate);
  }

  const { stage, look } = session.world;
  stage.updateCamera(cameraTarget, look.yaw, look.pitch, Math.min(elapsedMs, MAX_ANIMATION_DELTA_MS) / 1000);
  return { spectating, spectatingNickname };
};

/** Whose Character's nameplate wears the speaking cue this frame, by session id. */
const speakingPlayerIds = (session: GameSession): ReadonlySet<string> => {
  const speaking = session.callbacks.speakingAccounts?.();
  if (speaking === undefined || speaking.size === 0) return NOBODY_SPEAKING;
  const ids = new Set<string>();
  for (const [id, accountId] of Object.entries(session.roster.accounts)) {
    if (accountId !== null && speaking.has(accountId)) ids.add(id);
  }
  return ids;
};

/** Shared rather than rebuilt: nobody is talking most frames of most Rounds. */
const NOBODY_SPEAKING: ReadonlySet<string> = new Set();

/**
 * Where everyone is, for Voice chat (ADR 0111) — raised after the camera has
 * been aimed, so the pose a voice is placed against is this frame's, not the
 * one before it.
 *
 * An eliminated Character is left out on purpose: its body stays in the world
 * with its collider disabled (ADR 0043), but the Player behind it is watching
 * rather than standing there, and the ADR hears them flat. So is anyone whose
 * seat never authenticated — the relay names speakers by Account, and an
 * anonymous seat has none.
 */
const placeVoices = (session: GameSession, frame: DrawnFrame): void => {
  const sink = session.callbacks.onVoiceScene;
  if (sink === undefined) return;
  const { roster, myId } = session;
  const speakers = new Map<string, Vec3>();
  for (const [id, character] of Object.entries({ ...frame.remote, [myId]: frame.visual })) {
    const accountId = roster.accounts[id];
    if (accountId == null || character.eliminated) continue;
    speakers.set(accountId, character.position);
  }
  sink({ listener: session.world.stage.listenerPose(), speakers });
};

/** The banner and the Match's own voice (M14 ticket 10), on the ui bus beside it. */
const speak = (
  session: GameSession,
  frame: DrawnFrame,
  spectating: boolean,
  spectatingNickname: string | undefined,
  now: number,
): void => {
  const { hud, myId, match, net } = session;
  const latest = net.latestSnapshot;
  // Read off the authoritative snapshot, not the local prediction: this client
  // only predicts its own Character, so it is the only side that knows how
  // everyone else is doing (M4 ticket 05).
  const connectedPlayers = (latest ? Object.values(latest.characters).length : 0) || 1;
  // Elimination is derived, never replicated — "the Round ended and I have no
  // finishTick" is something both sides can already see. A mid-Match spectator
  // (M7 ticket 08) has no finishTick because they never played, not because
  // they were eliminated — the banner must not say otherwise.
  const serverHasMe = latest?.characters[myId] !== undefined;
  const eliminated = serverHasMe && isEliminated(match.phase, latest?.characters[myId]?.finishTick ?? null);
  hud.setBanner(
    matchBanner({
      phase: match.phase,
      connectedPlayers,
      playersToStart: session.welcome.config.playersToStart,
      eliminated,
      ...(spectatingNickname === undefined ? {} : { spectatingNickname }),
    }),
  );
  for (const call of session.matchCalls.update({
    phase: match.phase,
    serverNowMs: net.timeSync.ready ? now + net.timeSync.serverClockOffsetMs : null,
    countdownEndsAtMs: match.countdownEndsAtServerMs,
    timeLeftMs: match.timeLeftMs,
    checkpointIndex: frame.own.checkpointIndex,
    qualified: frame.own.finishTick !== null,
    spectating,
    results: match.resultsCall,
  })) {
    session.world.stage.sound?.play(call);
  }
};

/**
 * The rAF loop. `sendInput` is handed in because it belongs to the socket, not
 * to the frame: the prediction calls it once per *tick* it buffers, not once
 * per frame drawn.
 */
export const createFrameLoop = (session: GameSession, sendInput: () => void): { start: () => void; stop: () => void } => {
  let lastFrame = performance.now();
  let handle = 0;
  // Last frame's pointer lock — a release mid-Match is the pause (ADR 0110).
  let wasLocked = false;
  /** The facing sampled last frame, which this frame's first tick eases from (ADR 0109). */
  let previousFacing: number | null = null;

  const frame = (now: number): void => {
    const elapsedMs = now - lastFrame;
    lastFrame = now;

    const { net, world } = session;
    net.timeSync.tick(elapsedMs);
    if (net.timeSync.ready) net.serverInterp.setServerClockOffsetMs(net.timeSync.serverClockOffsetMs);

    if (net.connectionLost) {
      // Freeze on the last frame — no reconnect in M2 (ADR 0011). Render once
      // more so the HUD updates, then let the loop stop. `onExit` has already
      // told the shell; stopping the game is its call, not ours.
      session.hud.setStatus("connection lost — reload the page to rejoin");
      world.stage.render();
      return;
    }

    const input = sampleInput(session);
    // World this client doesn't predict — Props and every other Player's
    // Character — comes from the render-delay interpolation buffer (ADR 0003).
    // Sampled before the predict loop, because the mirrors and Prop obstacles
    // are placed from it.
    const serverRender = net.serverInterp.ready ? net.serverInterp.sample(now) : null;

    seedPredictionTick(world.predictionLoop, net.timeSync, net.serverInterp, now, elapsedMs);

    pinObstacles(session, serverRender);

    // Fixed-timestep prediction: one shared sim step per tick, each fed — and
    // sent to the server, from `onBuffered` — with that tick's own input (ADR
    // 0109), and each buffered by tick number for reconciliation (ADR 0005,
    // 0013, 0021). The phase is what lets the shared step gate it (M5 ticket
    // 01): real input still goes over the wire while locked, same as the server
    // has always had; only whether it moves the Character is decided, on both
    // sides identically.
    const leadMs = leadAdjustMs(net.lead, elapsedMs, net.timeSync.ready);
    world.predictionLoop.step(inputPerTick(input, previousFacing), elapsedMs + leadMs, sendInput, session.match.phase);
    previousFacing = input.facing;

    // The local world as it is drawn: the prediction's newest tick, blended
    // back toward the one before by the sub-tick alpha. Composed before the
    // Prop state machine, which seeds a handed-back Prop's offset from where it
    // is drawn (ADR 0109) — the newest tick raw runs up to a tick of motion
    // ahead of that, and the hand-back frame drew the jump.
    const snapshot = world.localSim.snapshot();
    const localAlpha = world.predictionLoop.accumulatorMs / TICK_MS;
    const render = interpolateState(world.predictionLoop.previousSnapshot ?? snapshot, snapshot, localAlpha);

    // Advance the pushed-Prop state machine (ADR 0022) for this frame: which
    // Props the local capsule just touched, grace expiry, and one render frame
    // of error-offset decay. After the predict loop, so contacts and poses are
    // current. The contact set is drained either way, so it cannot accumulate a
    // stale burst while the interpolated world is briefly unavailable — in that
    // window the machine is reset to all-pinned.
    const contacted = world.localSim.consumeContactedProps();
    if (serverRender) {
      net.propPrediction.frame({
        contacted,
        predictionTick: world.predictionLoop.tick,
        graceTicks: graceTicksForRtt(net.timeSync.rttMs),
        dtMs: Math.min(elapsedMs, MAX_ANIMATION_DELTA_MS),
        simProps: render.props,
        serverProps: serverRender.props,
      });
    } else {
      net.propPrediction.reset();
    }
    const drawn = composeDraw(session, { snapshot, render, localAlpha }, serverRender, elapsedMs, now);

    drawWorld(session, drawn, input, elapsedMs, now);
    const { spectating, spectatingNickname } = aimCamera(session, drawn, serverRender, elapsedMs);
    placeVoices(session, drawn);
    speak(session, drawn, spectating, spectatingNickname, now);

    world.stage.render();
    session.hud.setLockPromptVisible(!world.look.locked);
    // ADR 0110: letting go of the mouse mid-Match pauses — the sheet, never the
    // Round. Only on the release itself: a Player who never took the mouse (the
    // start of a Round) is asked to click, not paused.
    if (wasLocked && !world.look.locked && session.match.phase !== "LOBBY") session.callbacks.onPause?.();
    wasLocked = world.look.locked;

    handle = requestAnimationFrame(frame);
  };

  return {
    start: () => {
      lastFrame = performance.now();
      handle = requestAnimationFrame(frame);
    },
    stop: () => cancelAnimationFrame(handle),
  };
};
