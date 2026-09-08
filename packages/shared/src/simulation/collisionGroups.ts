/** Rapier collision-group membership bits for the DON'T FALL world. */
export const GROUP_STATIC = 0b0001;
export const GROUP_CHARACTER = 0b0010;
export const GROUP_RAGDOLL = 0b0100;
export const GROUP_OBSTACLE = 0b1000;
export const GROUP_PROP = 0b10000;

/** Pack a membership mask and a filter mask into Rapier's 32-bit collision-groups value. */
export const collisionGroups = (membership: number, filter: number): number =>
  ((membership << 16) | filter) >>> 0;

/** Static geometry: it is in the static group and collides with everything. */
export const STATIC_GROUPS = collisionGroups(GROUP_STATIC, 0xffff);

/**
 * The kinematic capsule: collides with static geometry, Obstacles, Props and
 * *other Characters* (ticket 04 — two players are solid to each other), never
 * the ragdoll. Character-to-Character contact is what a Bump is computed from.
 */
export const CHARACTER_GROUPS = collisionGroups(
  GROUP_CHARACTER,
  GROUP_STATIC | GROUP_OBSTACLE | GROUP_PROP | GROUP_CHARACTER,
);

/**
 * Ragdoll bones: collide with static geometry, dynamic Props (M2 ticket 08 —
 * playtesting showed a dash into a box flung the ragdoll straight through it),
 * and — since M6 ticket 05 / ADR 0047 — *each other*, so an arm no longer
 * passes through the chest it is attached to. Bones that share a joint have
 * their contacts turned off individually (`Ragdoll`), since those overlap by
 * construction.
 *
 * Still not the owning capsule, not the Spinner, and not other players'
 * capsules — the capsule stays the authority for player-vs-player. One
 * ragdoll's bones now meet another's, which is what this bit says; research
 * §3.3 called that a later decision and this is it.
 */
export const RAGDOLL_GROUPS = collisionGroups(GROUP_RAGDOLL, GROUP_STATIC | GROUP_PROP | GROUP_RAGDOLL);

/** A Spinner's rotating bar: only needs to be seen by the Character. */
export const OBSTACLE_GROUPS = collisionGroups(GROUP_OBSTACLE, GROUP_CHARACTER);

/** Dynamic props: rest on static geometry, get pushed by the Character or a ragdoll (ticket 08), and bump each other. */
export const PROP_GROUPS = collisionGroups(
  GROUP_PROP,
  GROUP_STATIC | GROUP_CHARACTER | GROUP_PROP | GROUP_RAGDOLL,
);
