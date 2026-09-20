/**
 * Rebindable controls (M9 controls): every shortcut a Player holds —
 * movement, jump, dash, hit, grab, spectator cycle, and Push-to-talk (ADR
 * 0111) — as data, not constants in `input.ts`. The client resolves held devices through these, the Settings
 * CONTROLS tab edits them, and the API stores one record per Account. Like
 * cosmetics, shared owns the shape and the rules; the API only persists
 * what this module already blessed.
 */

/**
 * Every action a control can drive — UI chrome (Esc-back, form keys) is never
 * bindable.
 *
 * All of them are gameplay but `talk`, which holds Push-to-talk (ADR 0111):
 * it is not a sim input, never reaches `sampleInput`, and is listened for at
 * the app level so it works on a Screen as well as in a Round. Key bindings
 * therefore stopped meaning "gameplay actions only" the day it was added.
 */
export const BINDING_ACTIONS = [
  "forward",
  "back",
  "left",
  "right",
  "jump",
  "dash",
  "hit",
  "grab",
  "spectateNext",
  "talk",
] as const;
export type BindingAction = (typeof BINDING_ACTIONS)[number];

/**
 * One physical control: a keyboard `code` (`KeyW`, `Space`, …) or a mouse
 * button (`Mouse0` = left through `Mouse4` = second side button). Validated
 * by {@link isBindableControl}, never trusted raw.
 */
export type Control = string;

/** One action's controls, in display order — empty means unbound, never an error. */
export type KeyBindings = Record<BindingAction, Control[]>;

/** Sanity cap per action: four alternatives are plenty, forty are a paste accident. */
export const MAX_CONTROLS_PER_ACTION = 4;

/**
 * Whether `control` may drive an action. Letters, digits (+numpad digits),
 * punctuation, Space, arrows, bare modifiers and five mouse buttons.
 * Deliberately not: Escape (exits pointer lock and backs out of practice —
 * binding it would eat the browser's own gesture), Tab (focus navigation),
 * Enter (form submit), CapsLock (a toggle, not a hold), F-keys
 * (browser-reserved: help, reload, fullscreen, devtools).
 */
export const isBindableControl = (control: unknown): control is string =>
  typeof control === "string" &&
  /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|Arrow(Up|Down|Left|Right)|Space|(Shift|Control|Alt)(Left|Right)|Mouse[0-4])$/.test(
    control,
  );

/**
 * Today's hardcoded layout, as data (WASD + arrows, Space, both Shifts, F,
 * G, C, and V for Push-to-talk — the design's own caption). Cloned, never
 * handed out, by {@link resolveBindings} — see below.
 */
export const DEFAULT_BINDINGS: KeyBindings = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  jump: ["Space"],
  dash: ["ShiftLeft", "ShiftRight"],
  hit: ["KeyF"],
  grab: ["KeyG"],
  spectateNext: ["KeyC"],
  talk: ["KeyV"],
};

/** A deep-enough copy: fresh arrays, so editing the result never touches the source. */
export const cloneBindings = (bindings: KeyBindings): KeyBindings =>
  Object.fromEntries(BINDING_ACTIONS.map((action) => [action, [...bindings[action]]])) as KeyBindings;

/**
 * Why `value` is not a storable bindings record, or `undefined` when it is —
 * the API's PUT validation, in cosmetics' own shape. A PUT replaces the
 * whole record, so partial records are rejected, not merged: merging is
 * `resolveBindings`' job on read.
 */
export const invalidBindingsReason = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "bindings must be an object";
  const record = value as Record<string, unknown>;
  for (const action of BINDING_ACTIONS) {
    if (!(action in record)) return `bindings is missing action "${action}"`;
  }
  for (const [action, controls] of Object.entries(record)) {
    if (!BINDING_ACTIONS.includes(action as BindingAction)) return `bindings has unknown action "${action}"`;
    if (!Array.isArray(controls)) return `bindings["${action}"] must be an array of controls`;
    if (controls.length > MAX_CONTROLS_PER_ACTION)
      return `bindings["${action}"] holds too many controls (max ${MAX_CONTROLS_PER_ACTION})`;
    for (const control of controls) {
      if (!isBindableControl(control)) return `bindings["${action}"] holds unbindable control ${JSON.stringify(control)}`;
    }
  }
  return undefined;
};

/**
 * A stored record as it can still be played with, or `null` when there is
 * nothing in it to read — what both **read** paths use (the API's stored
 * column, the client's localStorage mirror).
 *
 * Unlike {@link invalidBindingsReason}, which is the PUT's validation and
 * demands a complete record, this never rejects one for a *missing* action:
 * {@link resolveBindings} fills those from the defaults. Without that,
 * adding an action — `talk` was the first (ADR 0111) — would silently reset
 * every custom layout ever saved, on the very upgrade that added it.
 *
 * `null` is reserved for a value with no action in it at all: that is nothing
 * stored, not a partial record.
 */
export const storedBindings = (value: unknown): KeyBindings | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!BINDING_ACTIONS.some((action) => Array.isArray(record[action]))) return null;
  return resolveBindings(record);
};

/**
 * Stored data (or nothing) into a usable record: defaults underneath,
 * each valid stored action over them, anything else dropped. Forward-
 * compatible by construction — an older record missing a future action
 * still resolves — and always fresh arrays, so the caller owns the result.
 */
export const resolveBindings = (stored: unknown): KeyBindings => {
  const resolved = cloneBindings(DEFAULT_BINDINGS);
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return resolved;
  for (const action of BINDING_ACTIONS) {
    const controls = (stored as Record<string, unknown>)[action];
    if (!Array.isArray(controls)) continue;
    resolved[action] = controls.filter(isBindableControl).slice(0, MAX_CONTROLS_PER_ACTION);
  }
  return resolved;
};

const MOUSE_LABELS: Record<string, string> = {
  Mouse0: "Left Click",
  Mouse1: "Middle Click",
  Mouse2: "Right Click",
  Mouse3: "Mouse 4",
  Mouse4: "Mouse 5",
};
const MOUSE_SHORT_LABELS: Record<string, string> = {
  Mouse0: "LMB",
  Mouse1: "MMB",
  Mouse2: "RMB",
  Mouse3: "M4",
  Mouse4: "M5",
};
const PUNCTUATION_LABELS: Record<string, string> = {
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
};

/**
 * `KeyW` → `W`, `ShiftLeft` → `Left Shift`, `Mouse0` → `Left Click` — what a
 * settings row shows. `"short"` collapses to HUD width (`Shift`, `LMB`) —
 * the one cascade both dialects share, so they can't drift apart.
 */
export const controlLabel = (control: string, style: "full" | "short" = "full"): string => {
  if (control in MOUSE_LABELS) return style === "short" ? MOUSE_SHORT_LABELS[control]! : MOUSE_LABELS[control]!;
  if (control in PUNCTUATION_LABELS) return PUNCTUATION_LABELS[control]!;
  if (control === "Space") return "Space";
  const arrow = /^Arrow(Up|Down|Left|Right)$/.exec(control);
  if (arrow) return arrow[1]!;
  const modifier = /^(Shift|Control|Alt)(Left|Right)$/.exec(control);
  if (modifier) {
    const name = modifier[1] === "Control" ? "Ctrl" : modifier[1]!;
    return style === "short" ? name : `${modifier[2]} ${name}`;
  }
  const key = /^Key([A-Z])$/.exec(control);
  if (key) return key[1]!;
  const digit = /^Digit([0-9])$/.exec(control);
  if (digit) return digit[1]!;
  const numpad = /^Numpad([0-9])$/.exec(control);
  if (numpad) return style === "short" ? `Num${numpad[1]}` : `Num ${numpad[1]}`;
  return control;
};

/** One control driving more than one action — allowed, but the UI warns. */
export interface BindingConflict {
  control: string;
  actions: BindingAction[];
}

/** Every conflict in `bindings`, sorted by control — deterministic, so the UI renders a stable list. */
export const findConflicts = (bindings: KeyBindings): BindingConflict[] => {
  const byControl = new Map<string, BindingAction[]>();
  for (const action of BINDING_ACTIONS) {
    for (const control of bindings[action]) {
      const actions = byControl.get(control) ?? [];
      actions.push(action);
      byControl.set(control, actions);
    }
  }
  return [...byControl.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([control, actions]) => ({ control, actions: [...actions].sort() as BindingAction[] }))
    .sort((a, b) => (a.control < b.control ? -1 : 1));
};
