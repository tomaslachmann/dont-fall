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

/** The kinematic capsule: collides with static geometry, Obstacles and Props (never the ragdoll). */
export const CHARACTER_GROUPS = collisionGroups(
  GROUP_CHARACTER,
  GROUP_STATIC | GROUP_OBSTACLE | GROUP_PROP,
);

/**
 * Ragdoll bones: collide with static geometry only — not the capsule, not each
 * other, and deliberately not Obstacles or Props either (ticket 06 scopes
 * Spinner/Prop interaction to the Controlled Character only; a downed
 * Character passing through them is an accepted M1 simplification, not an
 * oversight — revisit only if playtesting says it matters).
 */
export const RAGDOLL_GROUPS = collisionGroups(GROUP_RAGDOLL, GROUP_STATIC);

/** A Spinner's rotating bar: only needs to be seen by the Character. */
export const OBSTACLE_GROUPS = collisionGroups(GROUP_OBSTACLE, GROUP_CHARACTER);

/** Dynamic props: rest on static geometry, get pushed by the Character, and bump each other. */
export const PROP_GROUPS = collisionGroups(
  GROUP_PROP,
  GROUP_STATIC | GROUP_CHARACTER | GROUP_PROP,
);
