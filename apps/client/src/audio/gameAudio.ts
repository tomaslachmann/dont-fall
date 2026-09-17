import { AudioContext as ThreeAudioContext } from "three";
import { sharedAudioContext } from "./sharedContext.js";

/**
 * The one `AudioContext` the game plays through (ADR 0087): the page's shared
 * context (`sharedContext.ts`, which the Lobby's music may already be using),
 * handed to three.js so its `AudioListener` uses it too. `null` in an
 * environment without Web Audio (jsdom, or a browser without it), where the
 * game runs silently.
 */
export const gameAudioContext = (): AudioContext | null => {
  const context = sharedAudioContext();
  if (context) ThreeAudioContext.setContext(context);
  return context;
};
