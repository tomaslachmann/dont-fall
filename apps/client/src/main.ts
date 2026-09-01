import {
  DASH_COOLDOWN_MS,
  DEFAULT_KILL_PLANE_Y,
  DEFAULT_SERVER_PORT,
  PLAYGROUND_CHECKPOINTS,
  PLAYGROUND_PROPS,
  PLAYGROUND_SPINNERS,
  PLAYGROUND_STATICS,
  RapierSimulation,
  TICK_MS,
  TICK_RATE_HZ,
  advanceFixed,
  initPhysics,
  interpolateState,
  movementDirection,
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

  // The local Character is predicted by re-running the exact same shared
  // simulation step the server uses (ticket 03) — its own RapierSimulation,
  // ticked every frame from local input, corrected only when the server
  // disagrees (`reconcileCharacter`).
  let localSim: RapierSimulation | null = null;
  let localAccumulatorMs = 0;
  let localPreviousSnapshot: SimState | undefined;

  // World content this client does not predict — Spinner rotation, Props —
  // comes straight from the server's own broadcast (ADR 0003).
  let serverPreviousSnapshot: SimState | null = null;
  let latestServerSnapshot: SimState | null = null;
  let latestServerSnapshotReceivedAt = 0;

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
        if (serverCharacter) localSim.reconcileCharacter(myId, serverCharacter);

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
      }
    }
  });
  socket.addEventListener("error", (event) => console.error("DON'T FALL: connection error", event));
  socket.addEventListener("close", () => console.warn("DON'T FALL: disconnected from server"));

  // Relays this client's input to the server once per simulation tick,
  // independent of local prediction — the server never trusts client state,
  // only client input (ADR 0002).
  setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) return;
    const moveDirection = movementDirection(keyboard.movementKeys(), look.yaw);
    const message: ClientMessage = {
      type: "input",
      input: { moveDirection, jumpHeld: keyboard.jumpHeld(), dashHeld: keyboard.dashHeld() },
    };
    socket.send(JSON.stringify(message));
  }, TICK_MS);

  let lastFrame = performance.now();
  let fps = 0;

  const frame = (now: number) => {
    const elapsedMs = now - lastFrame;
    lastFrame = now;
    fps += (1000 / Math.max(elapsedMs, 1) - fps) * 0.1;

    if (myId && localSim) {
      const input: SimInputs = {
        moveDirection: movementDirection(keyboard.movementKeys(), look.yaw),
        jumpHeld: keyboard.jumpHeld(),
        dashHeld: keyboard.dashHeld(),
      };
      const result = advanceFixed({
        simulation: localSim,
        input: { [myId]: input },
        accumulatorMs: localAccumulatorMs,
        elapsedMs,
        ...(localPreviousSnapshot ? { previousSnapshot: localPreviousSnapshot } : {}),
      });
      localAccumulatorMs = result.accumulatorMs;
      localPreviousSnapshot = result.previousSnapshot;

      const localAlpha = localAccumulatorMs / TICK_MS;
      const render = interpolateState(result.previousSnapshot, result.snapshot, localAlpha);
      const renderCharacter = render.characters[myId]!;
      const c = result.snapshot.characters[myId]!;

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
      const props: PropSnapshot[] = serverRender?.props ?? [];
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
        `DON'T FALL — M2 · predicted\n` +
        `sim ${TICK_RATE_HZ} Hz · render ${fps.toFixed(0)} fps · tick ${result.snapshot.tick}\n` +
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
