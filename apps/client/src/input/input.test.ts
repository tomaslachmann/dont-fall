import { describe, expect, it } from "vitest";
import { FreeLookCamera, KeyboardInput } from "./input.js";

/**
 * A stand-in for `window` / `document` / the canvas that counts what is
 * currently registered on it. The point of these tests is ticket 01's
 * "starting and stopping twice leaves nothing behind": a listener that
 * survives `dispose` is a duplicate the second time the game boots, and a
 * duplicate keyboard listener is a Character that reacts twice to one keypress.
 */
const fakeTarget = () => {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  return {
    listenerCount: (): number => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    dispatch: (type: string, event: Record<string, unknown> = {}): void => {
      for (const listener of listeners.get(type) ?? []) (listener as EventListener)({ type, ...event } as never);
    },
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject): void => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject): void => {
      listeners.get(type)?.delete(listener);
    },
  };
};

describe("KeyboardInput", () => {
  it("reports held movement, jump and dash keys", () => {
    const target = fakeTarget();
    const keyboard = new KeyboardInput(target);

    target.dispatch("keydown", { code: "KeyW", preventDefault: () => {} });
    target.dispatch("keydown", { code: "Space", preventDefault: () => {} });
    target.dispatch("keydown", { code: "ShiftLeft", preventDefault: () => {} });
    target.dispatch("keydown", { code: "KeyF", preventDefault: () => {} });
    target.dispatch("keydown", { code: "KeyG", preventDefault: () => {} });

    expect(keyboard.movementKeys()).toEqual({ forward: true, back: false, left: false, right: false });
    expect(keyboard.jumpHeld()).toBe(true);
    expect(keyboard.dashHeld()).toBe(true);
    expect(keyboard.hitHeld()).toBe(true);
    expect(keyboard.grabHeld()).toBe(true);
  });

  it("clears held keys on blur, so a key held while the tab loses focus doesn't stick", () => {
    const target = fakeTarget();
    const keyboard = new KeyboardInput(target);
    target.dispatch("keydown", { code: "KeyW", preventDefault: () => {} });

    target.dispatch("blur");

    expect(keyboard.movementKeys().forward).toBe(false);
  });

  it("leaves no listener behind on dispose", () => {
    const target = fakeTarget();
    const keyboard = new KeyboardInput(target);
    expect(target.listenerCount()).toBeGreaterThan(0);

    keyboard.dispose();

    expect(target.listenerCount()).toBe(0);
  });

  it("stops reading keys once disposed", () => {
    const target = fakeTarget();
    const keyboard = new KeyboardInput(target);
    keyboard.dispose();

    target.dispatch("keydown", { code: "KeyW", preventDefault: () => {} });

    expect(keyboard.movementKeys().forward).toBe(false);
  });
});

describe("KeyboardInput spectator cycle (M7 ticket 07)", () => {
  it("counts one cycle press per keydown and drains on read", () => {
    const target = fakeTarget();
    const keyboard = new KeyboardInput(target);

    target.dispatch("keydown", { code: "KeyC", preventDefault: () => {} });
    target.dispatch("keydown", { code: "KeyC", preventDefault: () => {} });

    expect(keyboard.consumeSpectateNext()).toBe(2);
    expect(keyboard.consumeSpectateNext()).toBe(0);
  });

  it("ignores auto-repeat, so a held key cycles once", () => {
    const target = fakeTarget();
    const keyboard = new KeyboardInput(target);

    target.dispatch("keydown", { code: "KeyC", repeat: true, preventDefault: () => {} });

    expect(keyboard.consumeSpectateNext()).toBe(0);
  });

  it("does not mistake movement keys for the cycle key", () => {
    const target = fakeTarget();
    const keyboard = new KeyboardInput(target);

    target.dispatch("keydown", { code: "KeyW", preventDefault: () => {} });

    expect(keyboard.consumeSpectateNext()).toBe(0);
  });

  it("drops pending presses on blur and on dispose", () => {
    const blurred = fakeTarget();
    const keyboard = new KeyboardInput(blurred);
    blurred.dispatch("keydown", { code: "KeyC", preventDefault: () => {} });
    blurred.dispatch("blur");
    expect(keyboard.consumeSpectateNext()).toBe(0);

    const disposed = fakeTarget();
    const disposedKeyboard = new KeyboardInput(disposed);
    disposedKeyboard.dispose();
    disposed.dispatch("keydown", { code: "KeyC", preventDefault: () => {} });
    expect(disposedKeyboard.consumeSpectateNext()).toBe(0);
  });
});

describe("FreeLookCamera", () => {
  const lockedElement = (element: unknown) => ({ pointerLockElement: element }) as unknown as Document;

  it("turns raw mouse movement into yaw while the pointer is locked", () => {
    const element = fakeTarget();
    const doc = fakeTarget();
    const documentLike = Object.assign(doc, lockedElement(element)) as typeof doc & Document;
    const look = new FreeLookCamera(element as unknown as HTMLElement, documentLike);

    doc.dispatch("pointerlockchange");
    doc.dispatch("mousemove", { movementX: 100, movementY: 0 });

    expect(look.locked).toBe(true);
    expect(look.yaw).not.toBe(0);
  });

  it("ignores mouse movement while unlocked", () => {
    const element = fakeTarget();
    const doc = fakeTarget();
    const documentLike = Object.assign(doc, lockedElement(null)) as typeof doc & Document;
    const look = new FreeLookCamera(element as unknown as HTMLElement, documentLike);

    doc.dispatch("mousemove", { movementX: 100, movementY: 0 });

    expect(look.locked).toBe(false);
    expect(look.yaw).toBe(0);
  });

  it("leaves no listener behind on either the element or the document", () => {
    const element = fakeTarget();
    const doc = fakeTarget();
    const documentLike = Object.assign(doc, lockedElement(null)) as typeof doc & Document;
    const look = new FreeLookCamera(element as unknown as HTMLElement, documentLike);
    expect(element.listenerCount()).toBeGreaterThan(0);
    expect(doc.listenerCount()).toBeGreaterThan(0);

    look.dispose();

    expect(element.listenerCount()).toBe(0);
    expect(doc.listenerCount()).toBe(0);
  });
});
