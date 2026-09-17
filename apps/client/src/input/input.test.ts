import { DEFAULT_BINDINGS, resolveBindings } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { FreeLookCamera, PlayerInput } from "./input.js";

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

/** A `document` stand-in carrying only what button input reads: the lock state. */
const fakeDoc = (locked: boolean) => ({ pointerLockElement: locked ? {} : null }) as unknown as Document;

const key = (code: string, extra: Record<string, unknown> = {}) => ({ code, preventDefault: () => {}, ...extra });

describe("PlayerInput", () => {
  it("reports held movement, jump and dash keys", () => {
    const target = fakeTarget();
    const input = new PlayerInput(target);

    target.dispatch("keydown", key("KeyW"));
    target.dispatch("keydown", key("Space"));
    target.dispatch("keydown", key("ShiftLeft"));
    target.dispatch("keydown", key("KeyF"));
    target.dispatch("keydown", key("KeyG"));

    expect(input.movementKeys()).toEqual({ forward: true, back: false, left: false, right: false });
    expect(input.jumpHeld()).toBe(true);
    expect(input.dashHeld()).toBe(true);
    expect(input.hitHeld()).toBe(true);
    expect(input.grabHeld()).toBe(true);
  });

  it("clears held keys on blur, so a key held while the tab loses focus doesn't stick", () => {
    const target = fakeTarget();
    const input = new PlayerInput(target);
    target.dispatch("keydown", key("KeyW"));

    target.dispatch("blur");

    expect(input.movementKeys().forward).toBe(false);
  });

  it("leaves no listener behind on dispose", () => {
    const target = fakeTarget();
    const input = new PlayerInput(target);
    expect(target.listenerCount()).toBeGreaterThan(0);

    input.dispose();

    expect(target.listenerCount()).toBe(0);
  });

  it("stops reading keys once disposed", () => {
    const target = fakeTarget();
    const input = new PlayerInput(target);
    input.dispose();

    target.dispatch("keydown", key("KeyW"));

    expect(input.movementKeys().forward).toBe(false);
  });
});

describe("PlayerInput spectator cycle (M7 ticket 07)", () => {
  it("counts one cycle press per keydown and drains on read", () => {
    const target = fakeTarget();
    const input = new PlayerInput(target);

    target.dispatch("keydown", key("KeyC"));
    target.dispatch("keydown", key("KeyC"));

    expect(input.consumeSpectateNext()).toBe(2);
    expect(input.consumeSpectateNext()).toBe(0);
  });

  it("ignores auto-repeat, so a held key cycles once", () => {
    const target = fakeTarget();
    const input = new PlayerInput(target);

    target.dispatch("keydown", key("KeyC", { repeat: true }));

    expect(input.consumeSpectateNext()).toBe(0);
  });

  it("does not mistake movement keys for the cycle key", () => {
    const target = fakeTarget();
    const input = new PlayerInput(target);

    target.dispatch("keydown", key("KeyW"));

    expect(input.consumeSpectateNext()).toBe(0);
  });

  it("drops pending presses on blur and on dispose", () => {
    const blurred = fakeTarget();
    const input = new PlayerInput(blurred);
    blurred.dispatch("keydown", key("KeyC"));
    blurred.dispatch("blur");
    expect(input.consumeSpectateNext()).toBe(0);

    const disposed = fakeTarget();
    const disposedInput = new PlayerInput(disposed);
    disposedInput.dispose();
    disposed.dispatch("keydown", key("KeyC"));
    expect(disposedInput.consumeSpectateNext()).toBe(0);
  });
});

describe("PlayerInput custom bindings", () => {
  it("resolves actions through the bindings it was given, and unbound means never held", () => {
    const target = fakeTarget();
    const input = new PlayerInput(target, resolveBindings({ ...DEFAULT_BINDINGS, jump: ["KeyJ"], dash: [] }));

    target.dispatch("keydown", key("Space"));
    target.dispatch("keydown", key("ShiftLeft"));
    expect(input.jumpHeld()).toBe(false);
    expect(input.dashHeld()).toBe(false);

    target.dispatch("keydown", key("KeyJ"));
    expect(input.jumpHeld()).toBe(true);
  });

  it("swaps bindings live, so the game never reboots for a rebind", () => {
    const target = fakeTarget();
    const input = new PlayerInput(target);
    target.dispatch("keydown", key("KeyJ"));
    expect(input.jumpHeld()).toBe(false);

    input.setBindings(resolveBindings({ ...DEFAULT_BINDINGS, jump: ["KeyJ"] }));
    expect(input.jumpHeld()).toBe(true);
  });

  it("swallows the page default only for bound scroll/snatch keys, following a rebind", () => {
    const target = fakeTarget();
    const input = new PlayerInput(target);
    let swallowed = 0;
    const counting = (code: string) => ({ code, preventDefault: () => { swallowed += 1; } });

    target.dispatch("keydown", counting("Space"));
    expect(swallowed).toBe(1);

    input.setBindings(resolveBindings({ ...DEFAULT_BINDINGS, jump: ["KeyJ"] }));
    target.dispatch("keydown", counting("Space"));
    target.dispatch("keydown", counting("KeyJ"));
    expect(swallowed).toBe(1);
  });

  it("keeps swallowing a scroll key rebound onto any other action", () => {
    const target = fakeTarget();
    const input = new PlayerInput(target, resolveBindings({ ...DEFAULT_BINDINGS, jump: ["KeyJ"], hit: ["Space"] }));
    let swallowed = 0;

    target.dispatch("keydown", { code: "Space", preventDefault: () => { swallowed += 1; } });
    expect(swallowed).toBe(1);
    target.dispatch("keydown", key("Space"));
    expect(input.hitHeld()).toBe(true);
  });
});

describe("PlayerInput mouse buttons", () => {
  it("reads bound mouse buttons while the pointer is locked", () => {
    const target = fakeTarget();
    const input = new PlayerInput(
      target,
      resolveBindings({ ...DEFAULT_BINDINGS, hit: ["Mouse0"], grab: ["Mouse2"] }),
      fakeDoc(true),
    );

    target.dispatch("mousedown", { button: 0 });
    target.dispatch("mousedown", { button: 2 });
    expect(input.hitHeld()).toBe(true);
    expect(input.grabHeld()).toBe(true);

    target.dispatch("mouseup", { button: 0 });
    expect(input.hitHeld()).toBe(false);
    expect(input.grabHeld()).toBe(true);
  });

  it("ignores mouse buttons while unlocked, so the click that grabs the pointer never fires an action", () => {
    const target = fakeTarget();
    const input = new PlayerInput(target, resolveBindings({ ...DEFAULT_BINDINGS, hit: ["Mouse0"] }), fakeDoc(false));

    target.dispatch("mousedown", { button: 0 });
    expect(input.hitHeld()).toBe(false);
  });

  it("counts a mouse-bound spectator edge, like the keydown one", () => {
    const target = fakeTarget();
    const input = new PlayerInput(
      target,
      resolveBindings({ ...DEFAULT_BINDINGS, spectateNext: ["Mouse2"] }),
      fakeDoc(true),
    );

    target.dispatch("mousedown", { button: 2 });
    target.dispatch("mousedown", { button: 2 });
    expect(input.consumeSpectateNext()).toBe(2);

    const unlocked = fakeTarget();
    const unlockedInput = new PlayerInput(
      unlocked,
      resolveBindings({ ...DEFAULT_BINDINGS, spectateNext: ["Mouse2"] }),
      fakeDoc(false),
    );
    unlocked.dispatch("mousedown", { button: 2 });
    expect(unlockedInput.consumeSpectateNext()).toBe(0);
  });

  it("ignores buttons past Mouse4 and clears buttons on blur", () => {
    const target = fakeTarget();
    const input = new PlayerInput(
      target,
      resolveBindings({ ...DEFAULT_BINDINGS, hit: ["Mouse0"] }),
      fakeDoc(true),
    );
    target.dispatch("mousedown", { button: 5 });
    target.dispatch("mousedown", { button: 0 });
    expect(input.hitHeld()).toBe(true);

    target.dispatch("blur");
    expect(input.hitHeld()).toBe(false);
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
