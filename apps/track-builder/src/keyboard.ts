import type { MovementKeys } from "@dont-fall/shared";

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
const JUMP_CODES = ["Space"];
const DASH_CODES = ["ShiftLeft", "ShiftRight"];

/**
 * Minimal held-key tracker for playtest mode (ticket 05) — no pointer lock, no
 * camera look, just WASD/jump/dash. A self-contained subset of apps/client's
 * `KeyboardInput`; kept local rather than shared since it's this small and the
 * two apps otherwise have no reason to depend on each other.
 */
export class KeyboardInput {
  private readonly held = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener("keydown", (e) => this.held.add(e.code));
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

  jumpHeld(): boolean {
    return JUMP_CODES.some((code) => this.held.has(code));
  }

  dashHeld(): boolean {
    return DASH_CODES.some((code) => this.held.has(code));
  }
}
