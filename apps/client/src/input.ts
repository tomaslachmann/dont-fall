import type { MovementKeys } from "@dont-fall/shared";
import { clampPitch } from "./camera/springArm.js";

const MOVEMENT_CODES: Record<string, keyof MovementKeys> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};

/** Tracks held WASD/arrow keys and reports them as framework-agnostic {@link MovementKeys}. */
export class KeyboardInput {
  private readonly held = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener("keydown", (e) => {
      if (e.code in MOVEMENT_CODES) e.preventDefault(); // arrow keys would scroll the page
      this.held.add(e.code);
    });
    target.addEventListener("keyup", (e) => this.held.delete(e.code));
    target.addEventListener("blur", () => this.held.clear());
  }

  movementKeys(): MovementKeys {
    const keys: MovementKeys = { forward: false, back: false, left: false, right: false };
    for (const code of this.held) {
      const dir = MOVEMENT_CODES[code];
      if (dir) keys[dir] = true;
    }
    return keys;
  }
}

const YAW_PER_PIXEL = 0.005;
const PITCH_PER_PIXEL = 0.005;

/** Mouse-drag orbit for the third-person camera. Yaw is unbounded; pitch is kept in range. */
export class PointerOrbit {
  yaw = 0;
  pitch = clampPitch(0.35);
  private dragging = false;

  constructor(element: HTMLElement) {
    element.addEventListener("pointerdown", () => {
      this.dragging = true;
    });
    window.addEventListener("pointerup", () => {
      this.dragging = false;
    });
    window.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.yaw -= e.movementX * YAW_PER_PIXEL;
      this.pitch = clampPitch(this.pitch + e.movementY * PITCH_PER_PIXEL);
    });
  }
}
