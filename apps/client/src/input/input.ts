import type { MovementKeys } from "@dont-fall/shared";
import { applyLook } from "./camera/lookControls.js";
import { clampPitch } from "./camera/springArm.js";
import { listen, type ListenerTarget } from "../lib/listeners.js";

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
const HIT_CODES = ["KeyF"];
/** Codes whose default (page scroll) we swallow while playing. */
const SWALLOW_DEFAULT = new Set([...Object.keys(MOVEMENT_CODES), ...JUMP_CODES]);

/** Tracks held keys and reports them as framework-agnostic input for the sim. */
export class KeyboardInput {
  private readonly held = new Set<string>();
  private readonly detach: () => void;

  constructor(target: ListenerTarget = window) {
    const onKeyDown: EventListener = (event) => {
      const e = event as KeyboardEvent;
      if (SWALLOW_DEFAULT.has(e.code)) e.preventDefault();
      this.held.add(e.code);
    };
    const onKeyUp: EventListener = (event) => {
      this.held.delete((event as KeyboardEvent).code);
    };
    const onBlur: EventListener = () => this.held.clear();

    const stops = [
      listen(target, "keydown", onKeyDown),
      listen(target, "keyup", onKeyUp),
      listen(target, "blur", onBlur),
    ];
    this.detach = () => stops.forEach((stop) => stop());
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

  /** Whether the Hit button is held this tick (M6 ticket 03). */
  hitHeld(): boolean {
    return HIT_CODES.some((code) => this.held.has(code));
  }

  /**
   * Stop listening and forget every held key (M4 ticket 01). A game torn down
   * and started again in the same page session must not leave a second
   * keyboard listener behind, or one keypress reaches the sim twice.
   */
  dispose(): void {
    this.detach();
    this.held.clear();
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
  private readonly detach: () => void;
  private readonly doc: Document;

  constructor(element: HTMLElement, doc: Document = document) {
    this.doc = doc;
    const onClick: EventListener = () => {
      // Rejects if clicked during the browser's post-Esc cooldown; pointerlockerror
      // keeps isLocked correct, so we just swallow the noise.
      if (!this.isLocked) void element.requestPointerLock()?.catch(() => {});
    };
    const onPointerLockChange: EventListener = () => {
      this.isLocked = doc.pointerLockElement === element;
    };
    const onPointerLockError: EventListener = () => {
      this.isLocked = false;
    };
    const onMouseMove: EventListener = (event) => {
      if (!this.isLocked) return;
      const e = event as MouseEvent;
      const next = applyLook(this, e.movementX, e.movementY);
      this.yaw = next.yaw;
      this.pitch = next.pitch;
    };

    const elementTarget: ListenerTarget = element;
    const documentTarget: ListenerTarget = doc;
    const stops = [
      listen(elementTarget, "click", onClick),
      listen(documentTarget, "pointerlockchange", onPointerLockChange),
      listen(documentTarget, "pointerlockerror", onPointerLockError),
      listen(documentTarget, "mousemove", onMouseMove),
    ];
    this.detach = () => stops.forEach((stop) => stop());
  }

  /** Whether the pointer is currently locked (drives the "click to look" prompt). */
  get locked(): boolean {
    return this.isLocked;
  }

  /**
   * Stop listening and hand the pointer back (M4 ticket 01). The three
   * document-level listeners are the ones that would otherwise pile up across
   * a route away from the game and back; the lock itself has to be released
   * explicitly, or the canvas that grabbed it is gone while the browser still
   * considers the page locked.
   */
  dispose(): void {
    this.detach();
    if (this.isLocked) this.doc.exitPointerLock();
    this.isLocked = false;
  }
}
