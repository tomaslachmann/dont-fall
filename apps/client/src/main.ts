import {
  DASH_COOLDOWN_MS,
  DEFAULT_KILL_PLANE_Y,
  DEFAULT_SERVER_PORT,
  MAX_BUFFERED_INPUT_TICKS,
  MAX_STEPS_PER_FRAME,
  PLAYGROUND_CHECKPOINTS,
  PLAYGROUND_PROPS,
  PLAYGROUND_SPINNERS,
  PLAYGROUND_STATICS,
  PROP_LOCAL_SIM_GRACE_TICKS,
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

/**
 * Cap on the per-frame delta fed to the Character model's animation/facing
 * update. `advanceFixed` already bounds how many sim ticks a stalled frame
 * can catch up on; this bounds the render-only animation step the same way,
 * so a backgrounded-tab refocus can't snap the facing or jump the clip.
 */
const MAX_ANIMATION_DELTA_MS = 100;

/**
 * Interpolation fraction for world content this client does NOT predict
 * (Spinner rotation, Props — ADR 0003 predicts only the local Character),
 * driven by wall-clock time since the latest server snapshot arrived rather
 * than a local tick accumulator, since that snapshot's arrival cadence is
 * the only clock this client has for it.
 */
const alphaSince = (receivedAtMs: number, now: number): number =>
  Math.max(0, Math.min(1, (now - receivedAtMs) / TICK_MS));

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

  // Prop prediction (ticket 06, ADR 0012): ticks-of-grace left per Prop since
  // the local player last touched it. > 0 ⇒ the client simulates that Prop
  // locally (the push feels immediate) and renders its own result; 0 ⇒ the
  // Prop just follows the authoritative snapshot like any other remote entity.
  const propPushGrace: number[] = PLAYGROUND_PROPS.map(() => 0);

  // World content this client does not predict — Spinner rotation, Props, other
  // players — comes straight from the server's own broadcast (ADR 0003).
  let serverPreviousSnapshot: SimState | null = null;
  let latestServerSnapshot: SimState | null = null;
  let latestServerSnapshotReceivedAt = 0;

  const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const isDown = (state: CharacterSnapshot["motionState"]): boolean =>
    state === "Ragdoll" || state === "GettingUp";

  /**
   * Reconcile the local prediction against the server's authoritative snapshot
   * for our own Character (ticket 05). The server echoes the last input tick it
   * applied (`lastInputTick`); everything the client predicted past that point
   * is replayed forward from the corrected base.
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

    const predictedAtAck = positionHistory.get(acked);
    const positionError = predictedAtAck ? distance(predictedAtAck, server.position) : Infinity;

    const needsCorrection =
      serverDown || // while the server has us down, keep tracking it (ragdoll ignores input)
      localDown || // we predicted a knockdown the server didn't — get back up
      server.motionState !== localChar.motionState || // e.g. a Stagger we missed / are holding too long
      positionError > RECONCILE_POSITION_ERROR;
    if (!needsCorrection) return;

    sim.reconcileCharacter(id, server);
    if (!serverDown) {
      // Realign the tick counter so replayed ticks see the right Spinner phase,
      // reset any Prop we're pushing to the authoritative base so replay
      // re-pushes it from there (not a position local prediction advanced), then
      // re-run every unacknowledged input forward from the corrected base.
      sim.syncTick(serverTick);
      sim.resetLivePropsToSnapshot(serverProps);
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
      myId = message.id;
      localSim = new RapierSimulation({
        statics: PLAYGROUND_STATICS,
        checkpoints: PLAYGROUND_CHECKPOINTS,
        spinners: PLAYGROUND_SPINNERS,
        props: PLAYGROUND_PROPS,
        withDefaultCharacter: false,
      });
      // Seed the local prediction at the exact spawn the server used (the
      // per-player spawn grid, ticket 04) — ticket 03's reconcile deliberately
      // never corrects position, so prediction must start already aligned.
      localSim.addCharacter(myId, message.spawn);
    } else if (message.type === "snapshot") {
      serverPreviousSnapshot = latestServerSnapshot ?? message.state;
      latestServerSnapshot = message.state;
      latestServerSnapshotReceivedAt = performance.now();

      if (localSim && myId) {
        const serverCharacter = message.state.characters[myId];
        if (serverCharacter) {
          reconcile(localSim, myId, serverCharacter, message.state.tick, message.state.props);
        }

        // Every OTHER connected Character becomes a solid obstacle in the local
        // prediction world (ADR 0012), positioned from this snapshot — so the
        // local player's own predicted movement can't walk through them. A
        // downed player's snapshot position is their ragdoll pelvis, so their
        // mirror capsule sits low — an accepted M2 simplification (you can step
        // over a floored body; you can't walk through a standing one).
        const others: Record<string, Vec3> = {};
        for (const [id, character] of Object.entries(message.state.characters)) {
          if (id !== myId) others[id] = character.position;
        }
        localSim.syncMirrorCharacters(others);

        // Props follow the authoritative snapshot; one the local player is
        // actively pushing keeps its local simulation unless it has diverged
        // far enough that the server clearly resolved it elsewhere (ticket 06).
        const propHardCorrected = localSim.syncPropsToSnapshot(message.state.props);
        if (propHardCorrected) renderPreviousSnapshot = localSim.snapshot(); // don't blend across the jump
      }
    }
  });
  socket.addEventListener("error", (event) => console.error("DON'T FALL: connection error", event));
  socket.addEventListener("close", () => {
    console.warn("DON'T FALL: disconnected from server");
    connectionLost = true;
  });

  const sendInput = (tick: number, input: SimInputs): void => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "input", tick, input } satisfies ClientMessage));
  };

  let lastFrame = performance.now();
  let fps = 0;

  const frame = (now: number) => {
    const elapsedMs = now - lastFrame;
    lastFrame = now;
    fps += (1000 / Math.max(elapsedMs, 1) - fps) * 0.1;

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

      // Fixed-timestep prediction: one shared sim step per tick, each fed —
      // and sent to the server — with the input sampled for that tick, and
      // each buffered by tick number for reconciliation (ADR 0005, 0013). The
      // accumulator is clamped so a long stall drops its backlog rather than
      // spiralling; EPSILON absorbs float drift so an exact multiple still runs
      // its last tick (same guard as `advanceFixed`).
      const EPSILON_MS = 1e-6;
      predictionAccumulatorMs = Math.min(
        predictionAccumulatorMs + elapsedMs,
        TICK_MS * MAX_STEPS_PER_FRAME,
      );
      let steps = 0;
      while (predictionAccumulatorMs + EPSILON_MS >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
        predictionTick += 1;
        inputBuffer.push({ tick: predictionTick, input: sampledInput });
        sendInput(predictionTick, sampledInput);

        // Props with grace left are simulated locally this tick; the rest are
        // pinned to the snapshot inside `tick()` (ticket 06).
        localSim.setLocallyLiveProps(propPushGrace.flatMap((g, i) => (g > 0 ? [i] : [])));

        renderPreviousSnapshot = localSim.snapshot();
        localSim.tick({ [myId]: sampledInput });
        positionHistory.set(predictionTick, localSim.snapshot().characters[myId]!.position);

        for (let i = 0; i < propPushGrace.length; i += 1) {
          propPushGrace[i] = Math.max(0, propPushGrace[i]! - 1);
        }
        for (const i of localSim.getContactedProps()) propPushGrace[i] = PROP_LOCAL_SIM_GRACE_TICKS;

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
      const renderCharacter = render.characters[myId]!;
      const c = snapshot.characters[myId]!;
      const input = sampledInput;

      // World this client doesn't predict — Props and every other player's
      // Character — is drawn straight from the server broadcast, interpolated
      // between the last two snapshots (ADR 0003).
      const serverRender = latestServerSnapshot
        ? interpolateState(
            serverPreviousSnapshot ?? latestServerSnapshot,
            latestServerSnapshot,
            alphaSince(latestServerSnapshotReceivedAt, now),
          )
        : null;
      // A Prop the local player is pushing is drawn from the local prediction
      // (immediate); every other Prop from the interpolated snapshot (ticket 06).
      // Nothing is drawn until the first snapshot — before that the local Props
      // are still falling from their spawn poses.
      const props: PropSnapshot[] = serverRender
        ? render.props.map((localProp, i) =>
            propPushGrace[i]! > 0 ? localProp : (serverRender.props[i] ?? localProp),
          )
        : [];
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
      if (latestServerSnapshot) {
        stage.updateSpinners(latestServerSnapshot.tick + alphaSince(latestServerSnapshotReceivedAt, now));
      }
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
