import {
  buildTrackNav,
  initNavigation,
  initPhysics,
  provenNavLinks,
  resolveTrack,
  trackNavInput,
  type Module,
  type NavLink,
  type Track,
} from "@dont-fall/shared";
import type { NavMesh } from "recast-navigation";
import { botRouteTargets, buildBotLegs, type BotLeg } from "./botRoute.js";

/** What the NAVMESH viewport toggle draws (M17 ticket 02): the walkable mesh itself, plus the route a Bot would run over it. */
export interface BotNavOverlay {
  navMesh: NavMesh;
  legs: BotLeg[];
  /** The jumps, Springs and slides proven on it (ticket 05), each drawn as an arc from its run-up to where it landed. */
  links: readonly NavLink[];
}

/**
 * Builds the draft's navmesh and its route in the browser, from the same
 * `packages/shared` code the server runs (ADR 0129) — nothing builder-only
 * decides where a Bot can walk. `null` for an empty Track, which Recast
 * refuses outright rather than answering an empty mesh.
 */
export const buildBotNav = async (track: Track, library: Record<string, Module>): Promise<BotNavOverlay | null> => {
  if (track.length === 0) return null;
  // Links are proven by playing them in the real simulation (M17 ticket 05), so Rapier loads too.
  await Promise.all([initNavigation(), initPhysics()]);
  const resolved = resolveTrack(library, track);
  const input = trackNavInput(resolved);
  const nav = buildTrackNav(input, (plain) => provenNavLinks(resolved, plain, input));
  const legs = buildBotLegs(nav, botRouteTargets(resolved, track, library));
  return { navMesh: nav.navMesh, legs, links: nav.links };
};
