import { useEffect, useState } from "react";
import { browserStorage } from "../browserStorage.js";
import {
  readGameplaySettings,
  subscribeGameplaySettings,
  writeGameplaySettings,
  type GameplaySettings,
} from "../gameplaySettings.js";

/** The per-device gameplay settings (ADR 0110), live across the pause sheet, Settings and other tabs. */
export const useGameplaySettings = (): [GameplaySettings, (next: GameplaySettings) => void] => {
  const [settings, setSettings] = useState(() => readGameplaySettings(browserStorage()));
  useEffect(() => subscribeGameplaySettings(setSettings, browserStorage()), []);
  return [settings, (next) => writeGameplaySettings(browserStorage(), next)];
};
