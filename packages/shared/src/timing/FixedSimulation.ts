/**
 * The contract {@link advanceFixed} drives. Any object that advances in whole
 * ticks and can be read into a plain snapshot fits — `RapierSimulation` in
 * production, an in-memory fake in tests (ADR 0009).
 */
export interface FixedSimulation<TInput, TSnapshot> {
  /** Advance the world by exactly one fixed tick, applying `input`. */
  tick(input: TInput): void;
  /** Read the current world into a fresh plain snapshot. */
  snapshot(): TSnapshot;
}
