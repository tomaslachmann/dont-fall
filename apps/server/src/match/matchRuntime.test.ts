import { initPhysics, M1_TRACK } from "@dont-fall/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { MatchRuntime, type MatchConfig } from "./matchRuntime.js";
import type { FetchedTrack } from "../track/trackSource.js";

beforeAll(async () => {
  await initPhysics();
});

const fetched: FetchedTrack = {
  id: "test-track",
  revision: 1,
  track: M1_TRACK,
  timeLimitMs: 60_000,
  survivorTarget: 1,
};

const config: MatchConfig = {
  trackServiceUrl: "http://unused",
  trackFetchRetryOptions: {},
  countdownMs: 0,
  roundEndMs: 0,
  playersToStart: 2,
};

const seat = (rt: MatchRuntime, ...ids: string[]): void => {
  ids.forEach((id, joinOrder) => rt.lobbyPlayers.set(id, { id, nickname: id, ready: true, joinOrder }));
};

const characterIds = (rt: MatchRuntime): string[] => Object.keys(rt.simulation.snapshot().characters).sort();

describe("MatchRuntime spectators (M7 ticket 08)", () => {
  it("seats every Lobby Player when nobody is spectating", () => {
    const rt = new MatchRuntime(config, fetched);
    seat(rt, "a", "b");

    const built = rt.buildSimulationFor(M1_TRACK);

    expect(Object.keys(built.simulation.snapshot().characters).sort()).toEqual(["a", "b"]);
    built.simulation.dispose();
    rt.simulation.dispose();
  });

  it("leaves a mid-Match spectator in the Lobby's list but out of the Round", () => {
    const rt = new MatchRuntime(config, fetched);
    seat(rt, "a", "b", "c");
    rt.spectators.add("c");

    const built = rt.buildSimulationFor(M1_TRACK);

    expect([...rt.lobbyPlayers.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(Object.keys(built.simulation.snapshot().characters).sort()).toEqual(["a", "b"]);
    built.simulation.dispose();
    rt.simulation.dispose();
  });

  it("keeps spectators out of the next Round — they play from the next Match, not its next Round", () => {
    const rt = new MatchRuntime(config, fetched);
    seat(rt, "a", "b", "c");
    rt.spectators.add("c");

    rt.startNextRound(M1_TRACK);

    expect(rt.match.phase).toBe("COUNTDOWN");
    expect(characterIds(rt)).toEqual(["a", "b"]);
    rt.simulation.dispose();
  });

  it("a fresh Lobby clears spectators and seats everyone waiting again", () => {
    const rt = new MatchRuntime(config, fetched);
    seat(rt, "a", "b", "c");
    rt.spectators.add("c");
    rt.roundResults.push({ rows: [{ id: "a", placement: 1, qualified: true }] });

    rt.resetToFreshLobby(M1_TRACK);

    expect(rt.spectators.size).toBe(0);
    expect(rt.match.phase).toBe("LOBBY");
    expect(rt.roundResults).toEqual([]);
    expect(characterIds(rt)).toEqual(["a", "b", "c"]);
    rt.simulation.dispose();
  });
});
