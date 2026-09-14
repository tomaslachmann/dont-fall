import type { Skin } from "../ui/Avatar.js";

const SKINS: Skin[] = ["pink", "cyan", "mint", "gold", "grape"];

/**
 * Deterministic Player colour: a socket id hashes to a fixed skin, so a
 * Player keeps the same colour on every client, rather than shifting as the
 * roster reorders. (Character Select is still a stub — ADR 0052 — so this
 * stands in for a chosen skin everywhere a roster renders: lobby,
 * standings, countdown line.)
 */
export const skinForPlayerId = (id: string): Skin => {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 1_000_003;
  return SKINS[hash % SKINS.length]!;
};
