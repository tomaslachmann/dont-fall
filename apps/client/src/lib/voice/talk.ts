/**
 * Talking (ADR 0111) — the one listener that decides whether the Player is
 * being heard right now, and the only place that asks for a microphone.
 *
 * App-level, owned by the voice session rather than by the game, because a
 * Player talks on the Lobby Screen, in a Round, on Standings and on the
 * podium, and only one of those has a `PlayerInput` in it. So the rules
 * `PlayerInput` follows for a Round are followed here for the whole visit:
 * a mouse button counts only under pointer lock, and `blur` lets go of
 * everything.
 *
 * It adds one rule that has no meaning inside a Round and every meaning
 * outside it: a key typed into a text field is text. Otherwise naming a
 * private Lobby "victory" would broadcast four syllables of it.
 */
import type { KeyBindings } from "@dont-fall/shared";
import { browserStorage } from "../browserStorage.js";
import { flash } from "../flash.js";
import { listen, type ListenerTarget } from "../socket/listeners.js";
import { subscribeVoiceSettings, type VoiceSettings } from "../voiceSettings.js";
import { OpenMicGate } from "./gate.js";
import { limitOfMicrophoneError, talkLimit, VOICE_LIMIT_MESSAGE, type VoiceLimit } from "./support.js";
import {
  acquireMicrophone,
  setTalking,
  setVoiceFrameSink,
  voiceSessionRunning,
  voiceSessionSettings,
} from "./session.js";
import { sendVoiceFrame, setSelfSpeaking } from "./voiceSocket.js";

export interface TalkListenerOptions {
  /** Where the keys come from. Defaults to `window`. */
  target?: ListenerTarget;
  /** How the pointer-lock check is made. Defaults to `document`. */
  doc?: Pick<Document, "pointerLockElement" | "activeElement">;
  /** The bindings in force — re-read on every press, so a rebind lands without restarting anything. */
  getBindings: () => KeyBindings;
  /** Says why voice cannot talk here. A test's seam onto the browser's own capabilities. */
  limit?: () => VoiceLimit | null;
  /** Tells the Player. Defaults to a Flash message. */
  report?: (limit: VoiceLimit) => void;
  /** This page's clock — the open-mic gate's. */
  now?: () => number;
  /**
   * Where the settings store publishes its changes. Defaults to `window`;
   * a test passes its own so it can change the talk mode by hand.
   */
  settingsTarget?: EventTarget;
}

/** Elements whose keys are text, never controls. `contentEditable` counts too: the Track builder has one. */
const isTyping = (element: Element | null): boolean => {
  if (element === null) return false;
  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (element as HTMLElement).isContentEditable === true;
};

/**
 * Starts listening. Returns the stop, which also lets go of talk — the
 * session ending must never leave a microphone sending into a closed socket.
 */
export const startTalkListener = (options: TalkListenerOptions): (() => void) => {
  const target = options.target ?? window;
  const doc = options.doc ?? document;
  const limit = options.limit ?? talkLimit;
  const report = options.report ?? ((reason: VoiceLimit) => flash(VOICE_LIMIT_MESSAGE[reason], "error"));
  const now = options.now ?? Date.now;
  const settingsTarget = options.settingsTarget ?? (typeof window === "undefined" ? undefined : window);
  const gate = new OpenMicGate();

  /** Controls held down that are bound to `talk` — a Player may hold two of them. */
  const held = new Set<string>();
  /**
   * Said once per session. A Player who cannot talk will press the key again,
   * and a sticky error flash per press would bury the Screen under them.
   */
  const reported = new Set<VoiceLimit>();
  /** Whether the microphone has been asked for at all — the ask is on the first press, never on joining. */
  let asked = false;
  let ended = false;

  const complain = (reason: VoiceLimit): void => {
    if (reported.has(reason)) return;
    reported.add(reason);
    report(reason);
  };

  /**
   * Opens the microphone if it is not open yet. Reports the first honest
   * reason it could not, and gives up asking again this session — a refusal
   * is a decision the Player has to unmake in their browser, not something
   * pressing harder fixes.
   */
  const ensureMicrophone = (): void => {
    if (ended || asked || !voiceSessionRunning()) return;
    const known = limit();
    if (known !== null) {
      asked = true;
      complain(known);
      return;
    }
    asked = true;
    void acquireMicrophone().catch((err: unknown) => {
      if (ended) return;
      complain(limitOfMicrophoneError(err));
    });
  };

  /** Push-to-talk: sending is exactly "is a bound control held". */
  const refreshPushToTalk = (settings: VoiceSettings): void => {
    if (settings.talkMode !== "PUSH TO TALK") return;
    const wanted = held.size > 0 && settings.scope !== "OFF";
    setTalking(wanted);
    setSelfSpeaking(wanted);
  };

  const boundControls = (): readonly string[] => options.getBindings().talk;

  const pressed = (control: string): void => {
    if (ended) return;
    const settings = voiceSessionSettings();
    if (settings.scope === "OFF" || settings.talkMode !== "PUSH TO TALK") return;
    if (!boundControls().includes(control)) return;
    held.add(control);
    ensureMicrophone();
    refreshPushToTalk(settings);
  };

  const released = (control: string): void => {
    if (!held.delete(control)) return;
    refreshPushToTalk(voiceSessionSettings());
  };

  const onKeyDown: EventListener = (event) => {
    const e = event as KeyboardEvent;
    // Auto-repeat is not a second press, and a key typed into a field is text.
    if (e.repeat || isTyping(doc.activeElement)) return;
    pressed(e.code);
  };
  const onKeyUp: EventListener = (event) => released((event as KeyboardEvent).code);
  const onMouseDown: EventListener = (event) => {
    // Only while the game holds the pointer: outside it, the click that binds
    // the mouse would otherwise open the microphone on the way past.
    if (doc.pointerLockElement == null) return;
    const button = (event as MouseEvent).button;
    if (button >= 0 && button <= 4) pressed(`Mouse${button}`);
  };
  const onMouseUp: EventListener = (event) => released(`Mouse${(event as MouseEvent).button}`);
  const onBlur: EventListener = () => {
    held.clear();
    gate.close();
    setTalking(false);
    setSelfSpeaking(false);
  };

  /**
   * Every encoded frame the microphone produced. Push-to-talk has already
   * decided (the worklet gathers nothing while it is not talking), so this
   * only has the gate's decision left to make — and it makes it here, on the
   * frame, rather than on a timer that would be a frame behind.
   */
  setVoiceFrameSink((payload, level) => {
    if (ended) return;
    const settings = voiceSessionSettings();
    if (settings.scope === "OFF") return;
    if (settings.talkMode === "OPEN MIC") {
      const open = gate.open(level, now());
      setSelfSpeaking(open);
      if (!open) return;
    }
    sendVoiceFrame(payload);
  });

  /**
   * Open mic keeps the microphone gathering the whole time and lets the gate
   * decide frame by frame; push-to-talk gathers only while a control is held.
   * Re-applied whenever the Player changes either setting, so switching mode
   * mid-Round takes effect on the next frame rather than the next session.
   */
  const applyTalkMode = (settings: VoiceSettings = voiceSessionSettings()): void => {
    if (ended) return;
    if (settings.scope !== "OFF" && settings.talkMode === "OPEN MIC") {
      ensureMicrophone();
      setTalking(true);
      return;
    }
    gate.close();
    setSelfSpeaking(false);
    refreshPushToTalk(settings);
  };

  const stops = [
    listen(target, "keydown", onKeyDown),
    listen(target, "keyup", onKeyUp),
    listen(target, "mousedown", onMouseDown),
    listen(target, "mouseup", onMouseUp),
    listen(target, "blur", onBlur),
    // The session owns the settings themselves; talking is owned here, so the
    // mode change is applied here too rather than in two places at once. The
    // new settings arrive with the event, so this never depends on whether
    // the session's own subscription happened to run first.
    settingsTarget === undefined
      ? () => {}
      : subscribeVoiceSettings(applyTalkMode, browserStorage(), settingsTarget),
  ];

  applyTalkMode();

  return () => {
    if (ended) return;
    ended = true;
    for (const stop of stops) stop();
    held.clear();
    gate.close();
    setVoiceFrameSink(() => {});
    setTalking(false);
    setSelfSpeaking(false);
  };
};
