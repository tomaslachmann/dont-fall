import { IDLE_INPUTS, RapierSimulation, initPhysics, type SimState } from "@dont-fall/shared";

/**
 * Authoritative match server — stub until M2 (ADR 0002).
 *
 * It exists now only to prove the server constructs and steps the *same*
 * `RapierSimulation` as the client, from `@dont-fall/shared` (ADR 0005, 0009).
 * No networking, no match lifecycle, no fixed-time loop yet.
 */
export const stepHeadless = async (ticks: number): Promise<SimState> => {
  await initPhysics();
  const simulation = new RapierSimulation();
  for (let i = 0; i < ticks; i += 1) {
    simulation.tick(IDLE_INPUTS);
  }
  return simulation.snapshot();
};
