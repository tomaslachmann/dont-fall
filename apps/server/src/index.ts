import { IDLE_INPUTS, createInitialState, step, type SimState } from "@dont-fall/shared";

/**
 * Authoritative match server — stub until M2 (ADR 0002).
 *
 * It exists now only to prove the server runs the *same* simulation step as the
 * client, imported from `@dont-fall/shared` (ADR 0005). No networking, no match
 * lifecycle, no fixed-time loop yet — those arrive with the netcode milestone.
 */
export const stepHeadless = (ticks: number): SimState => {
  let state = createInitialState();
  for (let i = 0; i < ticks; i += 1) {
    state = step(state, IDLE_INPUTS);
  }
  return state;
};
