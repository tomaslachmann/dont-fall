import type { MovementKeys } from "@dont-fall/shared";
import { applyLook } from "./camera/lookControls.js";
import { clampPitch } from "./camera/springArm.js";
import { listen, type ListenerTarget } from "../lib/socket/listeners.js";

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
const GRAB_CODES = ["KeyG"];
/**
 * Cycles the followed Character in Spectator Mode (M7 ticket 07) — free of
 * every other binding above, and edge-triggered rather than held: one press
 * steps one Character, never a held-key spin.
 */
const SPECTATE_NEXT_CODES = ["KeyC"];
/** Codes whose default (page scroll) we swallow while playing. */
const SWALLOW_DEFAULT = new Set([...Object.keys(MOVEMENT_CODES), ...JUMP_CODES]);

/** Tracks held keys and reports them as framework-agnostic input for the sim. */
export class KeyboardInput {
  private readonly held = new Set<string>();
  private spectateNextPresses = 0;
  private readonly detach: () => void;

  constructor(target: ListenerTarget = window) {
    const onKeyDown: EventListener = (event) => {
      const e = event as KeyboardEvent;
      if (SWALLOW_DEFAULT.has(e.code)) e.preventDefault();
      this.held.add(e.code);
      if (!e.repeat && SPECTATE_NEXT_CODES.includes(e.code)) this.spectateNextPresses += 1;
    };
    const onKeyUp: EventListener = (event) => {
      this.held.delete((event as KeyboardEvent).code);
    };
    const onBlur: EventListener = () => {
      this.held.clear();
      this.spectateNextPresses = 0;
    };

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

  /** Whether the Grab button is held this tick (M6 ticket 04). */
  grabHeld(): boolean {
    return GRAB_CODES.some((code) => this.held.has(code));
  }

  /**
   * How many Spectator Mode cycle presses landed since the last call, which
   * drains the count (M7 ticket 07). Edge-triggered — auto-repeat never
   * counts — and drained every frame even while not spectating, so a `C`
   * typed elsewhere (a Lobby nickname, say) can't bank a stale cycle.
   */
  consumeSpectateNext(): number {
    const presses = this.spectateNextPresses;
    this.spectateNextPresses = 0;
    return presses;
  }

  /**
   * Stop listening and forget every held key (M4 ticket 01). A game torn down
   * and started again in the same page session must not leave a second
   * keyboard listener behind, or one keypress reaches the sim twice.
   */
  dispose(): void {
    this.detach();
    this.held.clear();
    this.spectateNextPresses = 0;
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
