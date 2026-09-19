import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { UNTITLED_TRACK_NAME, type LeaderboardBoard } from "@dont-fall/shared";
import { fetchLeaderboard } from "../lib/api/leaderboards.js";
import { useTrackList } from "../lib/hooks/useTrackList.js";
import Leaderboards from "./Leaderboards.js";

/**
 * `/leaderboards` (ADR 0110) — the main menu's LEADERBOARDS. The Race board
 * walks the raceable Tracks of the listing sign-in already loaded.
 */
export function LeaderboardsRoute() {
  const navigate = useNavigate();
  const [board, setBoard] = useState<LeaderboardBoard>("wins");
  const [trackIndex, setTrackIndex] = useState(0);
  const raceable = (useTrackList() ?? []).filter((track) => track.hasFinishZone);
  const track = raceable.length === 0 ? null : raceable[((trackIndex % raceable.length) + raceable.length) % raceable.length]!;
  const trackId = board === "race" ? track?.id : undefined;
  const { data } = useQuery({
    queryKey: ["leaderboard", board, trackId ?? null],
    queryFn: () => fetchLeaderboard(board, trackId),
    enabled: board !== "race" || trackId !== undefined,
  });
  return (
    <Leaderboards
      board={board}
      onBoard={setBoard}
      trackName={track === null ? null : (track.name ?? UNTITLED_TRACK_NAME).toUpperCase()}
      onTrack={raceable.length > 1 ? (step) => setTrackIndex((index) => index + step) : undefined}
      data={board === "race" && track === null ? { board, rows: [], you: null } : (data ?? null)}
      onBack={() => navigate("/")}
    />
  );
}
