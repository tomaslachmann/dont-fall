/**
 * The page's one `AudioContext` (ADR 0087), three-free so the menu bundle can
 * hold it: the Lobby's music plays before any game module loads (M14 ticket
 * 11). The game hands this same context to three.js (`gameAudio.ts`), so music
 * and the Stage's sounds share one graph. `null` without Web Audio (jsdom, or
 * a browser without it), where everything runs silently.
 */
let shared: AudioContext | null | undefined;

export const sharedAudioContext = (): AudioContext | null => {
  if (shared === undefined) {
    shared = typeof window !== "undefined" && typeof window.AudioContext === "function" ? new window.AudioContext() : null;
  }
  return shared;
};
