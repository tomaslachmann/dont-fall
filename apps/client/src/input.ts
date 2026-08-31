import type { MovementKeys } from "@dont-fall/shared";
import { applyLook } from "./camera/lookControls.js";
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

/**
 * Pointer-lock free-look for the third-person camera. Clicking `element` grabs
 * the pointer; raw mouse movement then drives yaw (unbounded) and pitch (clamped)
 * via {@link applyLook}. Esc or focus loss releases the lock — the browser
 * handles that; we just observe `pointerlockchange`.
 *
 * This is the only camera input model — the earlier mouse-drag orbit was removed
 * (ticket 02b) to avoid two competing schemes. Re-add drag only if pointer lock
 * proves awkward.
 */
export class FreeLookCamera {
  yaw = 0;
  pitch = clampPitch(0.35);

  private isLocked = false;

  constructor(element: HTMLElement) {
    element.addEventListener("click", () => {
      // Rejects if clicked during the browser's post-Esc cooldown; pointerlockerror
      // keeps isLocked correct, so we just swallow the noise.
      if (!this.isLocked) void element.requestPointerLock()?.catch(() => {});
    });

    document.addEventListener("pointerlockchange", () => {
      this.isLocked = document.pointerLockElement === element;
    });
    document.addEventListener("pointerlockerror", () => {
      this.isLocked = false;
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.isLocked) return;
      const next = applyLook(this, e.movementX, e.movementY);
      this.yaw = next.yaw;
      this.pitch = next.pitch;
    });
  }

  /** Whether the pointer is currently locked (drives the "click to look" prompt). */
  get locked(): boolean {
    return this.isLocked;
  }
}
