/**
 * Tuning constants for the DON'T FALL simulation, and the configuration that
 * happens to be numeric beside them — split by domain (codebase audit
 * 2026-09, ticket 8; the user's call). Every value the game's feel depends on
 * lives in one of these files as a named constant, never as a magic number
 * scattered through the sim or the client.
 *
 * Feel: `character`, `movement`, `surfaces`, `knockdown`, `fight`, `world`,
 * all counting in `clock`'s ticks. Configuration: `netcode`, `match`,
 * `economy`, `authoring`, `hud`, `voice`. Import the file you mean; this index is the
 * package's public face, so `@dont-fall/shared` still exports every one.
 */
export * from "./clock.js";
export * from "./character.js";
export * from "./movement.js";
export * from "./surfaces.js";
export * from "./knockdown.js";
export * from "./fight.js";
export * from "./world.js";
export * from "./netcode.js";
export * from "./match.js";
export * from "./economy.js";
export * from "./authoring.js";
export * from "./hud.js";
export * from "./voice.js";
