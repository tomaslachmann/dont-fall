import {
  DASH_COOLDOWN_MS,
  DEFAULT_KILL_PLANE_Y,
  DEFAULT_SERVER_PORT,
  INPUT_REDUNDANCY,
  MAX_BUFFERED_INPUT_TICKS,
  MAX_STEPS_PER_FRAME,
  PLAYGROUND_CHECKPOINTS,
  PLAYGROUND_PROPS,
  PLAYGROUND_SPINNERS,
  PLAYGROUND_STATICS,
  RECONCILE_POSITION_ERROR,
  RapierSimulation,
  TICK_MS,
  TICK_RATE_HZ,
  initPhysics,
  interpolateState,
  movementDirection,
  type CharacterSnapshot,
  type ClientMessage,
  type PropSnapshot,
  type RenderCharacter,
  type ServerMessage,
  type SimInputs,
  type SimState,
  type Vec3,
} from "@dont-fall/shared";
import { loadCharacterModel } from "./characterModel.js";
import { FreeLookCamera, KeyboardInput } from "./input.js";
import { createStage } from "./scene.js";
import { SnapshotInterpolator } from "./snapshotInterpolation.js";
import { TimeSync } from "./timeSync.js";

/**
 * Cap on the per-frame delta fed to the Character model's animation/facing
 * update. `advanceFixed` already bounds how many sim ticks a stalled frame
 * can catch up on; this bounds the render-only animation step the same way,
 * so a backgrounded-tab refocus can't snap the facing or jump the clip.
 */
const MAX_ANIMATION_DELTA_MS = 100;

const main = async () => {
  const hud = document.getElementById("hud")!;
  const lockPrompt = document.getElementById("lock-prompt")!;
  const [, characterModel] = await Promise.all([initPhysics(), loadCharacterModel()]);

  const stage = createStage({
    statics: PLAYGROUND_STATICS,
    checkpoints: PLAYGROUND_CHECKPOINTS,
    killPlaneY: DEFAULT_KILL_PLANE_Y,
    spinners: PLAYGROUND_SPINNERS,
    props: PLAYGROUND_PROPS,
    characterModel,
  });
  const keyboard = new KeyboardInput();
  const look = new FreeLookCamera(stage.domElement);

  let myId: string | null = null;
  // Issued in the welcome (ADR 0024). Stored for a future reclaim on reconnect;
  // M2 does not reconnect. `config` carries the server's snapshot rate etc.
  let sessionToken: string | null = null;
  let serverConfig: { snapshotHz: number; graceWindowMs: number } | null = null;
  // Set once the socket drops (tab still open, network/server gone). The game
  // loop freezes on the last frame and the HUD says so — there is no reconnect
  // in M2 (ADR 0011), a reload rejoins as a fresh player.
  let connectionLost = false;

  // The local Character is predicted by re-running the exact same shared
  // simulation step the server uses (ticket 03) — its own RapierSimulation,
  // stepped once per fixed sim tick from local input.
  let localSim: RapierSimulation | null = null;
  let predictionTick = 0; // this client's own monotonic sim-tick counter
  let predictionAccumulatorMs = 0;
  let renderPreviousSnapshot: SimState | undefined; // state one tick behind, for render interpolation

  // Reconciliation state (ticket 05, ADR 0013): every input this client sends
  // is buffered by the prediction tick it was for, along with the position it
  // predicted after that tick — so on a server correction the client can line
  // the two up tick-for-tick and replay everything since.
  const inputBuffer: { tick: number; input: SimInputs }[] = [];
  const positionHistory = new Map<number, Vec3>();

  // World content this client does not predict — Spinner rotation, Props, other
  // players, this player's own ragdoll while down — comes straight from the
  // server's own broadcast (ADR 0003), smoothed through a render-delay
  // interpolation buffer so it isn't jittered by uneven snapshot arrival.
  const serverInterp = new SnapshotInterpolator();
  // The raw latest snapshot, kept only for `reconcile` (tick-aligned replay).
  let latestServerSnapshot: SimState | null = null;
  // NTP-style clock sync (ADR 0019) — feeds the interpolation buffer's clock
  // and the net-graph RTT.
  const timeSync = new TimeSync();
  // The prediction tick the local Character first went down on, or null while
  // up (ADR 0023 prediction-tick guard). A server snapshot that reports
  // "not down" for a tick *before* this one hasn't seen the knockdown yet — it
  // is stale, not a disagreement, and must not revert the just-started ragdoll.
  let predictedDownAtTick: number | null = null;
  // Prediction LEAD (ADR 0021): how many ticks ahead of the estimated server
  // tick the client predicts, so the server's command buffer never starves.
  // `targetLead` is nudged from the server's reported `commandQueueDepth`;
  // `appliedLead` catches up to it one tick per frame (no step jerk).
  let smoothedQueueDepth = 1.5;
  let targetLead = 2;
  let appliedLead = 0;
  let leadSeeded = false;

  const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const isDown = (state: CharacterSnapshot["motionState"]): boolean =>
    state === "Ragdoll" || state === "GettingUp";

  /**
   * Reconcile the local prediction against the server's authoritative snapshot
   * for our own Character (ticket 05, ADR 0015). The server echoes the last
   * input tick it applied (`lastInputTick`); everything the client predicted
   * past that point is replayed forward from the corrected base.
   *
   * A server-reported down state (`Ragdoll`/`GettingUp`) is always synced,
   * unconditionally — safe because `localSim` is non-`authoritative` (see its
   * construction below): it never decides on its own when a knockdown ends,
   * so it can only ever be at or behind the server's down-state, never ahead
   * of it, and there is no "stale vs. live" report left to tell apart (ADR
   * 0015 supersedes ADR 0014's `bumpSeq` gate).
   */
  const reconcile = (
    sim: RapierSimulation,
    id: string,
    server: CharacterSnapshot,
    serverTick: number,
    serverProps: readonly PropSnapshot[],
  ): void => {
    const acked = server.lastInputTick;
    // Keep the entry AT `acked` — that's the tick the server's report is for,
    // and the baseline the same-tick position check compares against.
    for (const t of [...positionHistory.keys()]) if (t < acked) positionHistory.delete(t);
    const unacked = inputBuffer.filter((entry) => entry.tick > acked);
    inputBuffer.splice(0, inputBuffer.length, ...unacked);

    const localChar = sim.snapshot().characters[id]!;
    const serverDown = isDown(server.motionState);
    const localDown = isDown(localChar.motionState);

    // Prediction-tick guard (ADR 0023): the server can't have seen a knockdown
    // it hasn't yet processed the input for. A "not down" report for an input
    // tick before we predicted going down is stale — leave the ragdoll alone.
    if (localDown && !serverDown && predictedDownAtTick !== null && acked < predictedDownAtTick) {
      return;
    }

    const predictedAtAck = positionHistory.get(acked);
    const positionError = predictedAtAck ? distance(predictedAtAck, server.position) : Infinity;

    const needsCorrection =
      serverDown || // authority says down — always sync (fresh knock, phase change, or pelvis tracking)
      localDown || // we think we're down but the authority doesn't — only the server ends a knockdown
      server.motionState !== localChar.motionState || // e.g. a Stagger we missed / are holding too long
      positionError > RECONCILE_POSITION_ERROR;
    if (!needsCorrection) return;

    sim.reconcileCharacter(id, server);
    if (!serverDown) {
      // Realign the tick counter so replayed ticks see the right Spinner phase,
      // pin every Prop to the fresh authoritative pose so replayed ticks slide
      // against obstacles where the server has them, then re-run every
      // unacknowledged input forward from the corrected base.
      sim.syncTick(serverTick);
      sim.syncPropsToSnapshot(serverProps);
      const replayed = sim.replayLocalCharacter(id, unacked.map((entry) => entry.input));
      positionHistory.clear();
      unacked.forEach((entry, i) => {
        const p = replayed[i];
        if (p) positionHistory.set(entry.tick, p);
      });
    } else {
      positionHistory.clear();
    }
    // Don't let render interpolation blend a frame through the correction.
    renderPreviousSnapshot = sim.snapshot();
  };

  const socket = new WebSocket(`ws://${location.hostname}:${DEFAULT_SERVER_PORT}`);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data as string) as ServerMessage;
    if (message.type === "welcome") {
      myId = message.playerId;
      sessionToken = message.sessionToken;
      serverConfig = message.config;
      void sessionToken;
      void serverConfig;
      localSim = new RapierSimulation({
        statics: PLAYGROUND_STATICS,
        checkpoints: PLAYGROUND_CHECKPOINTS,
        spinners: PLAYGROUND_SPINNERS,
        props: PLAYGROUND_PROPS,
        withDefaultCharacter: false,
        // Never trust this Character's own settle-check to end a knockdown —
        // only a server snapshot can (ADR 0015). Makes `reconcile`'s
        // down-state sync safe to apply unconditionally.
        authoritative: false,
      });
      // Seed the local prediction at the exact spawn the server used (the
      // per-player spawn grid, ticket 04) — ticket 03's reconcile deliberately
      // never corrects position, so prediction must start already aligned.
      localSim.addCharacter(myId, message.spawn);
    } else if (message.type === "pong") {
      timeSync.receivePong(message, performance.now());
    } else if (message.type === "snapshot") {
      latestServerSnapshot = message.state;
      serverInterp.receive(message.state, performance.now(), message.serverTimeMs);
      // Feedback for the prediction LEAD (ADR 0021): keep the server's command
      // queue near 1–2. Move `targetLead` slowly so it doesn't jerk.
      smoothedQueueDepth += (message.commandQueueDepth - smoothedQueueDepth) * 0.25;
      const nudge = smoothedQueueDepth < 1 ? 0.08 : smoothedQueueDepth > 2 ? -0.08 : 0;
      targetLead = Math.max(1, Math.min(3, targetLead + nudge));

      if (localSim && myId) {
        const serverCharacter = message.state.characters[myId];
        if (serverCharacter) {
          // `reconcile` pins Props to `message.state.props` itself before its
          // replay, so replayed ticks slide against Props where the server has
          // them (ADR 0016 — Props are never predicted). The live prediction's
          // Prop and mirror obstacles are re-pinned every frame from the
          // *interpolated* render pose instead — see the frame loop — so an
          // obstacle sits exactly where it's drawn and advances smoothly
          // between snapshots rather than jumping once per snapshot (which,
          // for a Prop you're pushing, read as a per-snapshot sawtooth / lag).
          reconcile(localSim, myId, serverCharacter, message.state.tick, message.state.props);
        }
      }
    }
  });
  socket.addEventListener("error", (event) => console.error("DON'T FALL: connection error", event));
  socket.addEventListener("close", () => {
    console.warn("DON'T FALL: disconnected from server");
    connectionLost = true;
    clearInterval(pingInterval);
  });

  // Time-sync probes (ADR 0019): a burst on connect to converge the estimate
  // fast, then one a second to track drift and RTT changes.
  const sendPing = (): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(timeSync.ping(performance.now())));
  };
  socket.addEventListener("open", () => {
    for (let i = 0; i < 8; i += 1) setTimeout(sendPing, i * 40);
  });
  const pingInterval = setInterval(sendPing, 1000);

  // Send the current tick's input plus a redundant tail of the last few unacked
  // ones (ADR 0021) — `inputBuffer` is already pruned to `tick > acked` by
  // `reconcile`, so its tail is exactly the unacknowledged set. A WebSocket
  // head-of-line burst or reorder then loses nothing; the server dedupes by tick.
  const sendInput = (): void => {
    if (socket.readyState !== WebSocket.OPEN) return;
    const tail = inputBuffer.slice(-(INPUT_REDUNDANCY + 1));
    socket.send(JSON.stringify({ type: "input", inputs: tail } satisfies ClientMessage));
  };

  let lastFrame = performance.now();
  let fps = 0;

  const frame = (now: number) => {
    const elapsedMs = now - lastFrame;
    lastFrame = now;
    fps += (1000 / Math.max(elapsedMs, 1) - fps) * 0.1;

    timeSync.tick(elapsedMs);
    if (timeSync.ready) {
      serverInterp.setServerClockOffsetMs(timeSync.serverClockOffsetMs);
      if (!leadSeeded) {
        targetLead = Math.max(1, Math.min(3, Math.ceil(timeSync.rttMs / 2 / TICK_MS) + 1));
        leadSeeded = true;
      }
    }

    if (connectionLost) {
      // Freeze on the last frame — no reconnect in M2 (ADR 0011). Render once
      // more so the HUD updates, then let the loop stop.
      hud.textContent = "DON'T FALL — connection lost\nreload the page to rejoin";
      stage.render();
      return;
    }

    if (myId && localSim) {
      const sampledInput: SimInputs = {
        moveDirection: movementDirection(keyboard.movementKeys(), look.yaw),
        jumpHeld: keyboard.jumpHeld(),
        dashHeld: keyboard.dashHeld(),
      };

      // World this client doesn't predict — Props and every other player's
      // Character — comes from the render-delay interpolation buffer (ADR 0003).
      // Computed here, before the predict loop, because the mirror capsules and
      // Prop obstacles are placed from it (below).
      const serverRender = serverInterp.ready ? serverInterp.sample(now) : null;

      // Refresh the obstacles this client's prediction slides against — other
      // players' mirror capsules (ADR 0012) and every Prop (ADR 0016) — every
      // frame from the *interpolated* render pose, so an obstacle sits exactly
      // where it's drawn and advances smoothly between snapshots instead of
      // jumping once per snapshot. For a Prop you're pushing, the jump-per-
      // snapshot version read as a sawtooth / lag: predict blocked → snap
      // forward on the next snapshot → predict blocked again.
      if (serverRender) {
        const others: Record<string, Vec3> = {};
        for (const [id, character] of Object.entries(serverRender.characters)) {
          const down = character.motionState === "Ragdoll" || character.motionState === "GettingUp";
          // A player who is down gets no mirror at all — you run through a
          // floored body rather than snag on a half-buried pelvis-height
          // capsule (the M2 simplification, made explicit).
          if (id !== myId && !down) others[id] = character.position;
        }
        localSim.syncMirrorCharacters(others);
        localSim.syncPropsToSnapshot(serverRender.props);
      }

      // Fixed-timestep prediction: one shared sim step per tick, each fed —
      // and sent to the server — with the input sampled for that tick, and
      // each buffered by tick number for reconciliation (ADR 0005, 0013). The
      // accumulator is clamped so a long stall drops its backlog rather than
      // spiralling; EPSILON absorbs float drift so an exact multiple still runs
      // its last tick (same guard as `advanceFixed`).
      const EPSILON_MS = 1e-6;
      // Catch `appliedLead` up to `targetLead` one tick at a time by adding (or,
      // when bleeding off, removing) a single tick of prediction this frame
      // (ADR 0021). `targetLead` moves slowly, so this converges without a jerk.
      let leadStepMs = 0;
      if (timeSync.ready && appliedLead < Math.round(targetLead)) {
        leadStepMs = TICK_MS;
        appliedLead += 1;
      } else if (timeSync.ready && appliedLead > Math.round(targetLead)) {
        leadStepMs = -TICK_MS;
        appliedLead -= 1;
      }
      predictionAccumulatorMs = Math.min(
        predictionAccumulatorMs + elapsedMs + leadStepMs,
        TICK_MS * MAX_STEPS_PER_FRAME,
      );
      let steps = 0;
      while (predictionAccumulatorMs + EPSILON_MS >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
        predictionTick += 1;
        inputBuffer.push({ tick: predictionTick, input: sampledInput });
        sendInput();

        renderPreviousSnapshot = localSim.snapshot();
        localSim.tick({ [myId]: sampledInput });
        const predicted = localSim.snapshot().characters[myId]!;
        positionHistory.set(predictionTick, predicted.position);
        // Track the tick we first predicted going down, for the reconcile guard.
        predictedDownAtTick = isDown(predicted.motionState)
          ? (predictedDownAtTick ?? predictionTick)
          : null;

        predictionAccumulatorMs -= TICK_MS;
        steps += 1;
      }
      if (predictionAccumulatorMs < 0) predictionAccumulatorMs = 0;

      // Bound the buffers if snapshots stop arriving (a stalled connection).
      while (inputBuffer.length > MAX_BUFFERED_INPUT_TICKS) inputBuffer.shift();
      for (const t of [...positionHistory.keys()]) {
        if (t <= predictionTick - MAX_BUFFERED_INPUT_TICKS) positionHistory.delete(t);
      }

      const snapshot = localSim.snapshot();
      const previous = renderPreviousSnapshot ?? snapshot;
      const localAlpha = predictionAccumulatorMs / TICK_MS;
      const render = interpolateState(previous, snapshot, localAlpha);
      const c = snapshot.characters[myId]!;
      const input = sampledInput;

      // While down, draw the local Character exactly like a remote one: from
      // the interpolated server snapshot, not the local prediction (ADR 0015
      // follow-up). `localSim` still runs its own cosmetic ragdoll physics for
      // the ~half-RTT feel before the first confirming snapshot arrives, but
      // once the server *has* confirmed the knockdown, its own down-state
      // pose is jitter-free by construction (the same 30 Hz interpolation
      // that already makes a remote Character's ragdoll look smooth) where
      // the local one drifts from independent, per-machine ragdoll physics
      // that only gets nudged back into rough alignment on every snapshot
      // (`Ragdoll.snapRootTo`) and isn't corrected at all while `GettingUp` —
      // a real reported glitch (an off-centre wall hit settles differently on
      // each side, then pops straight when `Controlled` resumes). There is
      // exactly one down-state position/pose on screen, and it's the server's.
      const localDown = c.motionState === "Ragdoll" || c.motionState === "GettingUp";
      const serverOwnCharacter = serverRender?.characters[myId];
      const renderCharacter =
        localDown && serverOwnCharacter && serverOwnCharacter.bones.length > 0
          ? serverOwnCharacter
          : render.characters[myId]!;
      // Every Prop is drawn from the interpolated server snapshot — never
      // locally predicted (ADR 0016). Nothing is drawn until the first
      // snapshot arrives.
      const props: PropSnapshot[] = serverRender ? serverRender.props : [];
      const remoteCharacters: Record<string, RenderCharacter> = {};
      if (serverRender) {
        for (const [id, character] of Object.entries(serverRender.characters)) {
          if (id !== myId) remoteCharacters[id] = character;
        }
      }

      stage.applyRenderState({ character: renderCharacter, props });
      stage.applyRemoteCharacters(remoteCharacters);
      stage.updateCharacterAnimation(
        Math.min(elapsedMs, MAX_ANIMATION_DELTA_MS) / 1000,
        input.moveDirection,
        c.grounded,
        c.dashing,
        c.dashSpeed,
      );
      // Spinner phase is a pure function of the tick and the client can compute
      // it at any tick exactly — so render it at the *prediction* tick, matching
      // what the local Character's own collision runs against, not the delayed
      // render tick (ADR 0025). `localSim` is synced to the server tick on each
      // reconcile, so its tick counter + the render-fraction is that phase.
      stage.updateSpinners(snapshot.tick + localAlpha);
      stage.updateCamera(renderCharacter.position, look.yaw, look.pitch);

      const cp = c.checkpointIndex === null ? "spawn" : `#${c.checkpointIndex + 1}`;
      const dashFill = Math.max(0, Math.min(10, Math.round((1 - c.dashCooldownMs / DASH_COOLDOWN_MS) * 10)));
      const dashBar = "#".repeat(dashFill) + "-".repeat(10 - dashFill);
      hud.textContent =
        `DON'T FALL — M2 · predicted + reconciled\n` +
        `sim ${TICK_RATE_HZ} Hz · render ${fps.toFixed(0)} fps · tick ${predictionTick}\n` +
        `pos ${c.position.x.toFixed(1)}, ${c.position.y.toFixed(1)}, ${c.position.z.toFixed(1)} · ${c.motionState}\n` +
        `checkpoint ${cp} · falls ${c.fallCount}\n` +
        `dash [${dashBar}]${c.dashCooldownMs === 0 ? " ready" : ""}\n` +
        `WASD move · Space jump · Shift dash · mouse look`;
    } else {
      hud.textContent = "DON'T FALL — M2 · connecting to server…";
    }

    stage.render();
    lockPrompt.hidden = look.locked;

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
};

void main();
