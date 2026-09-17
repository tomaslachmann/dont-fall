import type { CareerStats } from "@dont-fall/shared";
import { apiGet } from "./base.js";

/** One finished Match in the caller's career — the history row's whole world. */
export interface CareerMatch {
  matchId: string;
  placement: number;
  score: number;
  falls: number;
  rounds: number;
  trackNames: string[];
  endedAtMs: number;
}

/** The caller's whole career — the Profile screen's one fetch. */
export interface Career {
  stats: CareerStats;
  badges: { earned: string[]; total: number };
  matches: CareerMatch[];
}

/**
 * The client's half of `GET /career` — stats tiles, badges, and recent
 * Matches in one round trip. A career with no finished Matches is zeros and
 * an empty list, never a 404.
 */
export const fetchCareer = (): Promise<Career> => apiGet<Career>("/career");
