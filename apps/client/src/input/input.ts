import type { KeyBindings, MovementKeys } from "@dont-fall/shared";
import { cloneBindings, DEFAULT_BINDINGS } from "@dont-fall/shared";
import { applyLook } from "./camera/lookControls.js";
import { clampPitch } from "./camera/springArm.js";
import { listen, type ListenerTarget } from "../lib/socket/listeners.js";

/**
 * Codes whose page default (scroll) we swallow while playing — but only
 * when actually bound (M9 controls): an unbound Space scrolls the page it
 * sits on, a bound one jumps. Recomputed on every `setBindings`.
 */
const SWALLOWABLE = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/** Tracks held controls — keys and mouse buttons alike — and reports them as framework-agnostic input for the sim. */
export class PlayerInput {
  private readonly held = new Set<string>();
  private bindings: KeyBindings = cloneBindings(DEFAULT_BINDINGS);
  private swallow = new Set<string>();
  private spectateNextPresses = 0;
  private readonly detach: () => void;

  constructor(target: ListenerTarget = window, bindings: KeyBindings = DEFAULT_BINDINGS, doc: Document = document) {
    this.setBindings(bindings);
    const onKeyDown: EventListener = (event) => {
      const e = event as KeyboardEvent;
      if (this.swallow.has(e.code)) e.preventDefault();
      this.held.add(e.code);
      // Edge-triggered (M7 ticket 07): one press steps one Character in
      // Spectator Mode, never a held-key spin.
      if (!e.repeat && this.bindings.spectateNext.includes(e.code)) this.spectateNextPresses += 1;
    };
    const onKeyUp: EventListener = (event) => {
      this.held.delete((event as KeyboardEvent).code);
    };
    const onMouseDown: EventListener = (event) => {
      // Buttons only count while locked: the click that grabs the pointer
      // must never fire the action it lands on (a Mouse0 hit would punch
      // the air every time you click back into the game).
      if (doc.pointerLockElement == null) return;
      const button = (event as MouseEvent).button;
      if (button < 0 || button > 4) return;
      const control = `Mouse${button}`;
      this.held.add(control);
      // The spectator edge, like the keydown one above — mousedown never
      // auto-repeats, so no repeat guard is needed.
      if (this.bindings.spectateNext.includes(control)) this.spectateNextPresses += 1;
    };
    const onMouseUp: EventListener = (event) => {
      this.held.delete(`Mouse${(event as MouseEvent).button}`);
    };
    const onBlur: EventListener = () => {
      this.held.clear();
      this.spectateNextPresses = 0;
    };

    const stops = [
      listen(target, "keydown", onKeyDown),
      listen(target, "keyup", onKeyUp),
      listen(target, "mousedown", onMouseDown),
      listen(target, "mouseup", onMouseUp),
      listen(target, "blur", onBlur),
    ];
    this.detach = () => stops.forEach((stop) => stop());
  }

  /**
   * Swap the bindings live (M9 controls) — the Settings CONTROLS tab writes
   * through here, so a rebind takes effect without rebooting the game.
   * Cloned on the way in: the caller's record stays theirs to keep editing.
   */
  setBindings(bindings: KeyBindings): void {
    this.bindings = cloneBindings(bindings);
    // Every bound action feeds the swallow set: a Space rebound to Hit must
    // still not scroll the page out from under the game.
    this.swallow = new Set(Object.values(this.bindings).flat().filter((code) => SWALLOWABLE.has(code)));
  }

  /** The bindings in force right now — what the Round HUD prints its prompts from (ADR 0104). */
  get currentBindings(): KeyBindings {
    return this.bindings;
  }

  movementKeys(): MovementKeys {
    const keys: MovementKeys = { forward: false, back: false, left: false, right: false };
    for (const code of this.held) {
      for (const dir of ["forward", "back", "left", "right"] as const) {
        if (this.bindings[dir].includes(code)) keys[dir] = true;
      }
    }
    return keys;
  }

  jumpHeld(): boolean {
    return this.bindings.jump.some((code) => this.held.has(code));
  }

  dashHeld(): boolean {
    return this.bindings.dash.some((code) => this.held.has(code));
  }

  /** Whether the Hit button is held this tick (M6 ticket 03). */
  hitHeld(): boolean {
    return this.bindings.hit.some((code) => this.held.has(code));
  }

  /** Whether the Grab button is held this tick (M6 ticket 04). */
  grabHeld(): boolean {
    return this.bindings.grab.some((code) => this.held.has(code));
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
   * Stop listening and forget every held control (M4 ticket 01). A game torn
   * down and started again in the same page session must not leave a second
   * listener behind, or one keypress reaches the sim twice.
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
  private readonly element: HTMLElement;

  constructor(element: HTMLElement, doc: Document = document) {
    this.doc = doc;
    this.element = element;
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
   * Takes the pointer back (ADR 0110) — the pause sheet's resume. Needs the
   * user gesture it is called from; a refusal leaves the "click to look"
   * prompt up, as after any lost lock.
   */
  relock(): void {
    if (!this.isLocked) void this.element.requestPointerLock()?.catch(() => {});
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
