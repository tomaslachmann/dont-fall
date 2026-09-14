import { useQuery } from "@tanstack/react-query";
import { getGameSettings, type GameSettings } from "../api/settings.js";

/**
 * The live `GET /game-settings` values for Screens that used to hardcode
 * them (the Main Menu's beans-online count, the lobby-size pill). One
 * cached query, fresh for 30 seconds — every Screen mounting within that
 * window shares the answer instead of fetching again. `null` while loading
 * or when the API can't be reached — callers fall back to their honest
 * defaults, never to a mocked number.
 */
export const useGameSettings = (): GameSettings | null => {
  const { data } = useQuery({
    queryKey: ["game-settings"],
    queryFn: getGameSettings,
    staleTime: 30_000,
  });
  return data ?? null;
};
