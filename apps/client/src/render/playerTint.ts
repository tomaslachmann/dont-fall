/** FNV-1a — a small, fast, well-distributed string hash. Not cryptographic; just needs to spread session ids across hues. */
const hashString = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/**
 * A stable hue (degrees, [0, 360)) for a Player's session id (M6 ticket 02) —
 * the per-player color tint a real remote Character model needs now that
 * every Character shares one mesh (ADR 0046), replacing the "who's who" the
 * placeholder capsule's own tint used to give for free. Pure hash, not a
 * lookup table: needs no coordination between clients, and every client
 * derives the identical hue for the same id independently.
 */
export const tintHueForId = (id: string): number => hashString(id) % 360;
