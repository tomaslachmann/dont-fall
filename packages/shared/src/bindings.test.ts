import { describe, expect, it } from "vitest";
import {
  BINDING_ACTIONS,
  DEFAULT_BINDINGS,
  controlLabel,
  findConflicts,
  invalidBindingsReason,
  isBindableControl,
  resolveBindings,
  type KeyBindings,
} from "./bindings.js";

describe("isBindableControl", () => {
  it.each(["KeyW", "KeyZ", "Digit0", "Digit9", "Numpad1", "Space", "ArrowUp", "ShiftLeft", "ControlRight", "AltLeft"])(
    "accepts %s",
    (control) => expect(isBindableControl(control)).toBe(true),
  );

  it.each(["Mouse0", "Mouse1", "Mouse2", "Mouse3", "Mouse4"])("accepts mouse button %s", (control) =>
    expect(isBindableControl(control)).toBe(true),
  );

  it.each([
    "Minus",
    "Equal",
    "BracketLeft",
    "BracketRight",
    "Backslash",
    "Semicolon",
    "Quote",
    "Comma",
    "Period",
    "Slash",
    "Backquote",
  ])("accepts punctuation %s, like every other game", (control) => expect(isBindableControl(control)).toBe(true));

  it.each(["Escape", "Tab", "Enter", "CapsLock", "F1", "F12", "Mouse5", "KeyW ", " key", "", 42, null, undefined])(
    "rejects %s (browser-reserved, form input, or malformed)",
    (control) => expect(isBindableControl(control)).toBe(false),
  );
});

describe("DEFAULT_BINDINGS", () => {
  it("preserves today's hardcoded layout exactly", () => {
    expect(DEFAULT_BINDINGS).toEqual({
      forward: ["KeyW", "ArrowUp"],
      back: ["KeyS", "ArrowDown"],
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
      jump: ["Space"],
      dash: ["ShiftLeft", "ShiftRight"],
      hit: ["KeyF"],
      grab: ["KeyG"],
      spectateNext: ["KeyC"],
    });
    expect(Object.keys(DEFAULT_BINDINGS).sort()).toEqual([...BINDING_ACTIONS].sort());
  });
});

describe("invalidBindingsReason", () => {
  it("accepts the defaults and a full valid record", () => {
    expect(invalidBindingsReason(DEFAULT_BINDINGS)).toBeUndefined();
    expect(
      invalidBindingsReason({ ...DEFAULT_BINDINGS, hit: ["Mouse0"], jump: [] }),
    ).toBeUndefined();
  });

  it("rejects non-objects and incomplete records", () => {
    expect(invalidBindingsReason(null)).toMatch(/object/);
    expect(invalidBindingsReason([])).toMatch(/object/);
    const { jump: _dropped, ...missing } = DEFAULT_BINDINGS;
    expect(invalidBindingsReason(missing)).toMatch(/jump/);
  });

  it("rejects unknown actions and malformed lists", () => {
    expect(invalidBindingsReason({ ...DEFAULT_BINDINGS, fly: ["KeyF"] })).toMatch(/fly/);
    expect(invalidBindingsReason({ ...DEFAULT_BINDINGS, hit: "Mouse0" })).toMatch(/hit/);
    expect(invalidBindingsReason({ ...DEFAULT_BINDINGS, hit: ["Escape"] })).toMatch(/hit/);
    expect(invalidBindingsReason({ ...DEFAULT_BINDINGS, hit: ["KeyF", "KeyG", "KeyH", "KeyJ", "KeyK"] })).toMatch(
      /hit/,
    );
  });
});

describe("resolveBindings", () => {
  it("returns fresh defaults for null, garbage, and non-objects", () => {
    for (const stored of [null, undefined, 42, "KeyW", []]) {
      const resolved = resolveBindings(stored);
      expect(resolved).toEqual(DEFAULT_BINDINGS);
      expect(resolved.forward).not.toBe(DEFAULT_BINDINGS.forward);
    }
  });

  it("merges valid stored actions over defaults and drops the rest", () => {
    const resolved = resolveBindings({ hit: ["Mouse0"], jump: [], fly: ["KeyF"], dash: "nope" });
    expect(resolved.hit).toEqual(["Mouse0"]);
    expect(resolved.jump).toEqual([]);
    expect(resolved.dash).toEqual(DEFAULT_BINDINGS.dash);
    expect("fly" in resolved).toBe(false);
  });

  it("filters invalid controls per action but keeps the valid ones", () => {
    expect(resolveBindings({ ...DEFAULT_BINDINGS, hit: ["Mouse0", "Escape", 42] }).hit).toEqual(["Mouse0"]);
  });
});

describe("controlLabel", () => {
  it("names keys and mouse buttons the way a settings row should", () => {
    expect(controlLabel("KeyW")).toBe("W");
    expect(controlLabel("Digit3")).toBe("3");
    expect(controlLabel("Space")).toBe("Space");
    expect(controlLabel("ArrowUp")).toBe("Up");
    expect(controlLabel("ShiftLeft")).toBe("Left Shift");
    expect(controlLabel("ControlRight")).toBe("Right Ctrl");
    expect(controlLabel("Mouse0")).toBe("Left Click");
    expect(controlLabel("Mouse2")).toBe("Right Click");
    expect(controlLabel("Mouse3")).toBe("Mouse 4");
    expect(controlLabel("Comma")).toBe(",");
    expect(controlLabel("BracketLeft")).toBe("[");
  });

  it("shortens to HUD width on request — sides and clicks collapse", () => {
    expect(controlLabel("ShiftLeft", "short")).toBe("Shift");
    expect(controlLabel("ControlRight", "short")).toBe("Ctrl");
    expect(controlLabel("AltLeft", "short")).toBe("Alt");
    expect(controlLabel("Mouse0", "short")).toBe("LMB");
    expect(controlLabel("Mouse1", "short")).toBe("MMB");
    expect(controlLabel("Mouse2", "short")).toBe("RMB");
    expect(controlLabel("Mouse4", "short")).toBe("M5");
    expect(controlLabel("KeyW", "short")).toBe("W");
    expect(controlLabel("Comma", "short")).toBe(",");
  });
});

describe("findConflicts", () => {
  it("reports controls bound to more than one action, deterministically", () => {
    const bindings: KeyBindings = { ...DEFAULT_BINDINGS, hit: ["KeyF"], grab: ["KeyF"] };
    expect(findConflicts(bindings)).toEqual([{ control: "KeyF", actions: ["grab", "hit"] }]);
    expect(findConflicts(DEFAULT_BINDINGS)).toEqual([]);
  });
});
