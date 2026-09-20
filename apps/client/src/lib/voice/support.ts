/**
 * What this browser can do with Voice chat (ADR 0111), and what to say when
 * it cannot.
 *
 * Hearing and talking are asked separately, because they need different
 * things and a Player who cannot talk can still listen: hearing needs only a
 * WebCodecs decoder, while talking needs an encoder, an `AudioWorklet` and a
 * microphone the browser will only hand over on a secure origin.
 *
 * The floor this puts under voice is Chrome/Edge 94+, Firefox 130+ and
 * Safari 26+ — WebCodecs' own. Below it voice says so once and the game is
 * otherwise untouched.
 */

/** Why voice cannot do something here — each is a line the Player is shown, once, when they ask for it. */
export type VoiceLimit =
  /** No WebCodecs, or no Web Audio: nothing of voice works in this browser. */
  | "unsupported"
  /** `getUserMedia` exists only on a secure origin — http on anything but localhost has no microphone to ask for. */
  | "insecure"
  /** The browser has no microphone to offer, or the Player unplugged the only one. */
  | "noMicrophone"
  /** The Player said no, or their OS did. */
  | "refused";

/** What each limit says. Plain, and ending in what the Player can actually do about it. */
export const VOICE_LIMIT_MESSAGE: Readonly<Record<VoiceLimit, string>> = {
  unsupported: "Voice chat doesn't work in this browser. Try the latest Chrome, Edge, Firefox or Safari.",
  insecure: "Voice chat needs a secure connection (https). Ask whoever runs this server for one.",
  noMicrophone: "No microphone found. Plug one in, then press talk again.",
  refused: "Voice chat needs the microphone. Allow it in your browser's address bar, then press talk again.",
};

/** The globals voice reaches for — named, so a test can stand every one of them in. */
export interface VoiceEnvironment {
  AudioDecoder?: unknown;
  AudioEncoder?: unknown;
  AudioContext?: unknown;
  isSecureContext?: boolean;
  mediaDevices?: { getUserMedia?: unknown } | undefined;
}

const environmentOf = (): VoiceEnvironment =>
  typeof window === "undefined"
    ? {}
    : {
        AudioDecoder: (window as unknown as VoiceEnvironment).AudioDecoder,
        AudioEncoder: (window as unknown as VoiceEnvironment).AudioEncoder,
        AudioContext: window.AudioContext,
        isSecureContext: window.isSecureContext,
        mediaDevices: navigator.mediaDevices as unknown as VoiceEnvironment["mediaDevices"],
      };

/**
 * Whether anything of voice works here — a decoder and Web Audio. False means
 * the setting is shown as unavailable rather than offered and then silent.
 */
export const canHearVoice = (env: VoiceEnvironment = environmentOf()): boolean =>
  typeof env.AudioDecoder === "function" && typeof env.AudioContext === "function";

/**
 * Why this browser cannot talk, or `null` when it can be asked. Only the two
 * limits that are known before asking: a refusal and a missing microphone are
 * answers to the ask itself, so they come back from {@link VoiceLimit} at that
 * point instead.
 */
export const talkLimit = (env: VoiceEnvironment = environmentOf()): VoiceLimit | null => {
  if (!canHearVoice(env) || typeof env.AudioEncoder !== "function") return "unsupported";
  // A microphone is only offered on a secure origin. Saying "unsupported"
  // here would send someone off to change browsers over an http:// address.
  if (env.isSecureContext === false) return "insecure";
  if (typeof env.mediaDevices?.getUserMedia !== "function") return "unsupported";
  return null;
};

/** What a `getUserMedia` rejection actually was — its `name` is the only honest thing in it. */
export const limitOfMicrophoneError = (err: unknown): VoiceLimit => {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "noMicrophone";
  // NotAllowedError, SecurityError, and whatever a browser invents for "no":
  // every one of them means the Player has to allow it themselves.
  return "refused";
};
