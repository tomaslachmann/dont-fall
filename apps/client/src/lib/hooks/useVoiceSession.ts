import { useEffect, useRef } from "react";
import type { KeyBindings } from "@dont-fall/shared";
import { startVoiceSession } from "../voice/session.js";
import { startTalkListener } from "../voice/talk.js";

/**
 * Keeps Voice chat running while `active` (ADR 0111) — the socket, the
 * playback chain and the app-level talk listener, started and stopped
 * together. Mounted once, by `<AuthGate>`, so the session survives the
 * navigation from `/lobby` into a Match and on to the podium.
 *
 * The two modules are joined here rather than by one importing the other:
 * the talk listener drives the session, and having the session start the
 * listener in turn would make that a cycle.
 *
 * `getBindings` is read through a ref, so rebinding `talk` in Settings lands
 * on the next press rather than tearing the microphone down and opening it
 * again.
 */
export const useVoiceSession = (active: boolean, getBindings: () => KeyBindings): void => {
  const bindings = useRef(getBindings);
  bindings.current = getBindings;
  useEffect(() => {
    if (!active) return;
    const stopSession = startVoiceSession();
    const stopTalk = startTalkListener({ getBindings: () => bindings.current() });
    return () => {
      stopTalk();
      stopSession();
    };
  }, [active]);
};
