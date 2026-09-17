import { readAudioVolumes, subscribeAudioVolumes, volumeGain } from "../lib/audioSettings.js";
import { browserStorage } from "../lib/perfFlag.js";
import { createSoundEngine } from "./engine.js";
import { sharedAudioContext } from "./sharedContext.js";
import type { SoundSlot } from "./slots.js";
import { loadSoundBank } from "./soundBank.js";

/**
 * Screens click (M14 ticket 12, ADR 0087). Three-free, for the menu bundle:
 * a small engine of its own on the page's shared context, and one delegated
 * listener, so every button on every Screen sounds without each one wiring it.
 */

/** What pressing a control sounds like. `none` is silent. */
export type UiSound = "click" | "confirm" | "back" | "toggle" | "tick" | "none";

export const UI_SOUND_SLOTS: Readonly<Record<Exclude<UiSound, "none">, SoundSlot>> = {
  click: "ui.click",
  confirm: "ui.confirm",
  back: "ui.back",
  toggle: "ui.toggle",
  tick: "ui.tick",
};

/** The attribute a control names its sound with; without one, a switch toggles and any other button clicks. */
export const UI_SOUND_ATTRIBUTE = "data-ui-sound";

/** A slider ticks at most this often (ms) while it is dragged. */
export const TICK_MIN_INTERVAL_MS = 60;

const isUiSound = (value: string | null): value is UiSound =>
  value !== null && (value === "none" || value in UI_SOUND_SLOTS);

/**
 * The sound a press on `target` makes, or `null` for none: the nearest
 * enabled button, switch or marked control above it decides.
 */
export const uiSoundOf = (target: EventTarget | null): Exclude<UiSound, "none"> | null => {
  if (!(target instanceof Element)) return null;
  const control = target.closest(`[${UI_SOUND_ATTRIBUTE}], button, [role="switch"]`);
  if (!control || (control as HTMLButtonElement).disabled || control.getAttribute("aria-disabled") === "true") return null;
  const named = control.getAttribute(UI_SOUND_ATTRIBUTE);
  const sound: UiSound = isUiSound(named) ? named : control.getAttribute("role") === "switch" ? "toggle" : "click";
  return sound === "none" ? null : sound;
};

/**
 * Plays `play` for every press and slider move under `root`. Presses are
 * heard on `click` (a keyboard press too), sliders on `input`, at most once
 * per {@link TICK_MIN_INTERVAL_MS}. Returns the uninstall.
 */
export const installUiSounds = (
  root: EventTarget,
  play: (sound: Exclude<UiSound, "none">) => void,
  now: () => number = () => performance.now(),
): (() => void) => {
  let lastTickAt = -Infinity;
  const onClick = (event: Event): void => {
    const sound = uiSoundOf(event.target);
    // A range input's own clicks are its ticks.
    if (sound && !(event.target instanceof HTMLInputElement && event.target.type === "range")) play(sound);
  };
  const onInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "range") return;
    const named = target.getAttribute(UI_SOUND_ATTRIBUTE);
    if (named === "none") return;
    const at = now();
    if (at - lastTickAt < TICK_MIN_INTERVAL_MS) return;
    lastTickAt = at;
    play(isUiSound(named) && named !== "none" ? named : "tick");
  };
  root.addEventListener("click", onClick, true);
  root.addEventListener("input", onInput, true);
  return () => {
    root.removeEventListener("click", onClick, true);
    root.removeEventListener("input", onInput, true);
  };
};

/**
 * The page's UI sound player: the `ui.*` slots, decoded once, on their own
 * engine on the shared context, at the MASTER volume (there is no UI slider).
 *
 * Nothing is created until the first press, so the context is born inside a
 * gesture rather than suspended at page load. A press made while the context
 * is still suspended resumes it and is heard once it runs. Without Web Audio,
 * every press stays silent.
 */
export const createUiSoundPlayer = (
  contextOf: () => AudioContext | null = sharedAudioContext,
): ((sound: Exclude<UiSound, "none">) => void) => {
  let pending: Promise<ReturnType<typeof createSoundEngine>> | null = null;
  const start = (context: AudioContext): Promise<ReturnType<typeof createSoundEngine>> =>
    loadSoundBank(context, Object.values(UI_SOUND_SLOTS)).then((bank) => {
      const engine = createSoundEngine({ context, destination: context.destination, bank, listenerPosition: () => ({ x: 0, y: 0, z: 0 }) });
      const storage = browserStorage();
      const applyMaster = (master: number): void => engine.setVolume("master", volumeGain(master));
      applyMaster(readAudioVolumes(storage).master);
      subscribeAudioVolumes((volumes) => applyMaster(volumes.master), storage);
      return engine;
    });
  return (sound) => {
    const context = contextOf();
    if (!context) return;
    pending ??= start(context);
    const engine = pending;
    const play = (): void => {
      void engine.then((ready) => ready.play(UI_SOUND_SLOTS[sound]));
    };
    if (context.state === "running") play();
    else context.resume().then(play, () => {});
  };
};
