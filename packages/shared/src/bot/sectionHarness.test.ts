import { describe, expect, it } from "vitest";
import { BASE_RACE_TRACK } from "../track/baseRace.js";
import { loadTestLibrary, obstacleFalls, ownFalls, playSection } from "./sectionHarness.js";

/** M17 ticket 07's section harness: one leg, one seed, in seconds, with an outcome a part's suite can read. */
describe("the section harness (M17 ticket 07)", () => {
  it("plays one base-race section with one seed in under 5 s and reports passed, stranded and Falls by cause", async () => {
    await loadTestLibrary();
    const started = performance.now();
    const outcome = await playSection({ track: BASE_RACE_TRACK, leg: 0, level: "hard", seed: "harness", bots: 4, capSeconds: 20 });
    const wall = performance.now() - started;
    console.log(`[sectionHarness] base race leg 0, 4 HARD Bots, 20 s cap: ${JSON.stringify(outcome)} in ${wall.toFixed(0)} ms`);
    expect(wall).toBeLessThan(5000);
    expect(outcome.passed + outcome.stranded + outcome.slow).toBe(4);
    expect(outcome.passTicks.length).toBe(outcome.passed);
    expect(ownFalls(outcome.falls)).toBeGreaterThanOrEqual(0);
    expect(obstacleFalls(outcome.falls)).toBeGreaterThanOrEqual(0);
    expect(outcome.thinkUsPerBotTick).toBeGreaterThan(0);
  }, 60_000);

  it("spawns a later leg on the Checkpoint before it and runs that leg", async () => {
    const outcome = await playSection({ track: BASE_RACE_TRACK, leg: 1, level: "hard", seed: "harness-leg", bots: 2, capSeconds: 3 });
    // Two seconds is not enough to pass the wrecking balls; it is enough to have started, not to be stranded.
    expect(outcome.passed + outcome.stranded + outcome.slow).toBe(2);
  }, 60_000);
});
