import {
  DASH_COOLDOWN_MS,
  DEFAULT_KILL_PLANE_Y,
  DEFAULT_SERVER_PORT,
  PLAYGROUND_CHECKPOINTS,
  PLAYGROUND_PROPS,
  PLAYGROUND_SPINNERS,
  PLAYGROUND_STATICS,
  TICK_MS,
  TICK_RATE_HZ,
  interpolateState,
  movementDirection,
  type ClientMessage,
  type ServerMessage,
  type SimState,
} from "@dont-fall/shared";
import { loadCharacterModel } from "./characterModel.js";
import { FreeLookCamera, KeyboardInput } from "./input.js";
import { createStage } from "./scene.js";

/**
 * Cap on the per-frame delta fed to the Character model's animation/facing
 * update. Bounds the render-only animation step so a backgrounded-tab
 * refocus can't snap the facing or jump the clip.
 */
const MAX_ANIMATION_DELTA_MS = 100;

/**
 * No local simulation in ticket 02 — the client renders entirely from the
 * server's broadcast snapshots. `alpha` here is driven by wall-clock time
 * since the latest snapshot arrived (not a local tick accumulator), clamped
 * so a late/dropped packet holds the last pose rather than overshooting.
 */
const alphaSince = (receivedAtMs: number, now: number): number =>
  Math.max(0, Math.min(1, (now - receivedAtMs) / TICK_MS));

const main = async () => {
  const hud = document.getElementById("hud")!;
  const lockPrompt = document.getElementById("lock-prompt")!;
  const characterModel = await loadCharacterModel();

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
  let previousSnapshot: SimState | null = null;
  let latestSnapshot: SimState | null = null;
  let latestSnapshotReceivedAt = 0;

  const socket = new WebSocket(`ws://${location.hostname}:${DEFAULT_SERVER_PORT}`);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data as string) as ServerMessage;
    if (message.type === "welcome") {
      myId = message.id;
    } else if (message.type === "snapshot") {
      previousSnapshot = latestSnapshot ?? message.state;
      latestSnapshot = message.state;
      latestSnapshotReceivedAt = performance.now();
    }
  });
  socket.addEventListener("error", (event) => console.error("DON'T FALL: connection error", event));
  socket.addEventListener("close", () => console.warn("DON'T FALL: disconnected from server"));

  // Sends this client's current input once per simulation tick (30 Hz),
  // independent of render rate — the server, not this loop, decides when a
  // tick actually advances the Match.
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

    if (myId && latestSnapshot) {
      const c = latestSnapshot.characters[myId];
      if (c) {
        const alpha = alphaSince(latestSnapshotReceivedAt, now);
        const render = interpolateState(previousSnapshot ?? latestSnapshot, latestSnapshot, alpha);
        const renderCharacter = render.characters[myId]!;
        stage.applyRenderState({ character: renderCharacter, props: render.props });
        stage.updateCharacterAnimation(
          Math.min(elapsedMs, MAX_ANIMATION_DELTA_MS) / 1000,
          movementDirection(keyboard.movementKeys(), look.yaw),
          c.grounded,
          c.dashing,
        );
        stage.updateSpinners(latestSnapshot.tick + alpha);
        stage.updateCamera(renderCharacter.position, look.yaw, look.pitch);

        const cp = c.checkpointIndex === null ? "spawn" : `#${c.checkpointIndex + 1}`;
        const dashFill = Math.max(0, Math.min(10, Math.round((1 - c.dashCooldownMs / DASH_COOLDOWN_MS) * 10)));
        const dashBar = "#".repeat(dashFill) + "-".repeat(10 - dashFill);
        hud.textContent =
          `DON'T FALL — M2 · networked\n` +
          `sim ${TICK_RATE_HZ} Hz · render ${fps.toFixed(0)} fps · tick ${latestSnapshot.tick}\n` +
          `pos ${c.position.x.toFixed(1)}, ${c.position.y.toFixed(1)}, ${c.position.z.toFixed(1)} · ${c.motionState}\n` +
          `checkpoint ${cp} · falls ${c.fallCount}\n` +
          `dash [${dashBar}]${c.dashCooldownMs === 0 ? " ready" : ""}\n` +
          `WASD move · Space jump · Shift dash · mouse look`;
      }
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
