import type { MatchPhase } from "@dont-fall/shared";
import { useEffect } from "react";
import { setMusicPhase } from "../../audio/music.js";

/**
 * A Match's music while the route that holds its connection is mounted (M14
 * ticket 11): the Lobby's playlist in LOBBY, the Round's from COUNTDOWN on,
 * ducked at the Round's end. Unmounting hands the music back to the app's
 * own, the Lobby's playlist (`startAppMusic`). `phase` is `null` until the
 * first snapshot, which changes nothing.
 */
export const useMatchMusic = (phase: MatchPhase | null): void => {
  useEffect(() => {
    if (phase !== null) setMusicPhase(phase);
  }, [phase]);

  useEffect(() => () => setMusicPhase(null), []);
};
