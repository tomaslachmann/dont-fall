/**
 * Voice chat's per-device settings (ADR 0111): the scope a Player's voice
 * reaches, and how they talk. Stored per device like audio, video and the
 * gameplay rows — speakers and a microphone belong to the machine, not the
 * Account.
 *
 * Both places that show them read this one store: Settings → AUDIO and the
 * pause sheet's VOICE CHAT row. Three-free and socket-free on purpose, so the
 * menu bundle holds it and the voice session reads it without owning it.
 */
import {
  DEFAULT_TALK_MODE,
  DEFAULT_VOICE_SCOPE,
  isTalkMode,
  isVoiceScope,
  type TalkMode,
  type VoiceScope,
} from "@dont-fall/shared";

export interface VoiceSettings {
  scope: VoiceScope;
  talkMode: TalkMode;
}

/** PARTY and PUSH TO TALK — the design's own starting positions (ADR 0111). */
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { scope: DEFAULT_VOICE_SCOPE, talkMode: DEFAULT_TALK_MODE };

/** `dontfall.voice.v1` — per device, like `dontfall.audio.v1` beside it. */
export const VOICE_SETTINGS_STORAGE_KEY = "dontfall.voice.v1";

/** Dispatched on the window when this page writes new settings; other tabs hear the `storage` event instead. */
export const VOICE_SETTINGS_EVENT = "dontfall:voice-settings";

type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

/** The stored settings; anything missing or unreadable falls back to its default. Never throws. */
export const readVoiceSettings = (storage: SettingsStorage | null): VoiceSettings => {
  try {
    const raw = storage?.getItem(VOICE_SETTINGS_STORAGE_KEY);
    const stored: unknown = raw ? JSON.parse(raw) : null;
    const record = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
    return {
      scope: isVoiceScope(record.scope) ? record.scope : DEFAULT_VOICE_SETTINGS.scope,
      talkMode: isTalkMode(record.talkMode) ? record.talkMode : DEFAULT_VOICE_SETTINGS.talkMode,
    };
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
};

/**
 * Stores the settings and tells this page — the live voice session hears it at
 * once, and sends the relay its new scope without reconnecting. Quiet on a
 * storage failure: the change still reaches the session and lasts this visit.
 */
export const writeVoiceSettings = (
  storage: SettingsStorage | null,
  settings: VoiceSettings,
  target: EventTarget | null = typeof window === "undefined" ? null : window,
): void => {
  try {
    storage?.setItem(VOICE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // The change still reaches the session; it lasts only this visit.
  }
  target?.dispatchEvent(new CustomEvent<VoiceSettings>(VOICE_SETTINGS_EVENT, { detail: settings }));
};

/** Calls `listener` whenever the settings change, in this page or another tab. Returns the unsubscribe. */
export const subscribeVoiceSettings = (
  listener: (settings: VoiceSettings) => void,
  storage: SettingsStorage | null,
  target: EventTarget = window,
): (() => void) => {
  const onLocal = (event: Event): void => listener((event as CustomEvent<VoiceSettings>).detail ?? readVoiceSettings(storage));
  const onStorage = (event: Event): void => {
    if ((event as StorageEvent).key === VOICE_SETTINGS_STORAGE_KEY) listener(readVoiceSettings(storage));
  };
  target.addEventListener(VOICE_SETTINGS_EVENT, onLocal);
  target.addEventListener("storage", onStorage);
  return () => {
    target.removeEventListener(VOICE_SETTINGS_EVENT, onLocal);
    target.removeEventListener("storage", onStorage);
  };
};
