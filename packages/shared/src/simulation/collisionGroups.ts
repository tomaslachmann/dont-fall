/** Rapier collision-group membership bits for the DON'T FALL world. */
export const GROUP_STATIC = 0b0001;
export const GROUP_CHARACTER = 0b0010;
export const GROUP_RAGDOLL = 0b0100;

/** Pack a membership mask and a filter mask into Rapier's 32-bit collision-groups value. */
export const collisionGroups = (membership: number, filter: number): number =>
  ((membership << 16) | filter) >>> 0;

/** Static geometry: it is in the static group and collides with everything. */
export const STATIC_GROUPS = collisionGroups(GROUP_STATIC, 0xffff);

/** The kinematic capsule: collides with static geometry only (never the ragdoll). */
export const CHARACTER_GROUPS = collisionGroups(GROUP_CHARACTER, GROUP_STATIC);

/** Ragdoll bones: collide with static geometry only — not the capsule, not each other. */
export const RAGDOLL_GROUPS = collisionGroups(GROUP_RAGDOLL, GROUP_STATIC);
