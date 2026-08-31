import { vec3 } from "../math/vec3.js";
import { characterSnapshot, type SimState } from "../state/SimState.js";

/** The live Rapier reads {@link worldToSnapshot} needs — kept minimal and handle-free. */
export interface CharacterReadout {
  translation: { x: number; y: number; z: number };
  grounded: boolean;
}

/**
 * Build a plain {@link SimState} from the simulation's live entities. This is the
 * one place the Rapier world crosses into serialisable data (ADR 0009); it grows
 * a field per entity as later tickets add them.
 */
export const worldToSnapshot = (tick: number, character: CharacterReadout): SimState => ({
  tick,
  character: characterSnapshot(
    vec3(character.translation.x, character.translation.y, character.translation.z),
    character.grounded,
  ),
});
