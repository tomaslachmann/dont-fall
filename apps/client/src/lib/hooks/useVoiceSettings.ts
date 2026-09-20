import { useEffect, useState } from "react";
import { browserStorage } from "../browserStorage.js";
import {
  readVoiceSettings,
  subscribeVoiceSettings,
  writeVoiceSettings,
  type VoiceSettings,
} from "../voiceSettings.js";

/**
 * This device's Voice chat settings (ADR 0111), live across Settings → AUDIO,
 * the pause sheet's VOICE CHAT row, the running session and other tabs. The
 * shape `useGameplaySettings` beside it established.
 */
export const useVoiceSettings = (): [VoiceSettings, (next: VoiceSettings) => void] => {
  const [settings, setSettings] = useState(() => readVoiceSettings(browserStorage()));
  useEffect(() => subscribeVoiceSettings(setSettings, browserStorage()), []);
  return [settings, (next) => writeVoiceSettings(browserStorage(), next)];
};
