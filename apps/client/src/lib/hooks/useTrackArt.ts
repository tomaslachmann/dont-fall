import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TrackListing } from "@dont-fall/shared";
import { apiGet } from "../api/base.js";
import { preloadTrackArt } from "../trackArt.js";

/**
 * How long the first preload may hold sign-in up. A picture that has not
 * arrived by then is a stalled request, not a slow one; the screens that
 * show it fall back, and it still lands in the background.
 */
const FIRST_PRELOAD_GIVE_UP_MS = 10_000;

/**
 * Every Track's name and picture, loaded once right after sign-in (ADR
 * 0105). Reads the shared `["tracks"]` listing and preloads every picture it
 * names, again whenever a refetch brings a new one.
 *
 * Returns whether the first round is done: the listing is in and its
 * pictures have settled, or the listing failed, or the give-up passed. It
 * never goes back to false, so a later refetch loads in the background and
 * never holds a screen up.
 */
export const useTrackArt = (enabled: boolean): boolean => {
  const { data, isError } = useQuery({
    queryKey: ["tracks"],
    queryFn: () => apiGet<TrackListing[]>("/tracks"),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isError) setReady(true);
  }, [isError]);

  useEffect(() => {
    if (!enabled) return;
    const giveUp = setTimeout(() => setReady(true), FIRST_PRELOAD_GIVE_UP_MS);
    return () => clearTimeout(giveUp);
  }, [enabled]);

  useEffect(() => {
    if (data === undefined) return;
    let live = true;
    void preloadTrackArt(data).then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [data]);

  return ready;
};
