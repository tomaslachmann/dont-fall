// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams, useSearchParams } from "react-router";
import { DEFAULT_BINDINGS } from "@dont-fall/shared";
import { GameCanvas } from "./GameCanvas";
import { getGameActiveSnapshot } from "../lib/gamePresence.js";
import type { PracticeSnapshot } from "../game/practice.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { WithQuery } from "../test/query.js";
import { RewardsRoute } from "../screens/RewardsRoute.js";
import { ScoreboardRoute } from "../screens/ScoreboardRoute.js";

const { startGame } = vi.hoisted(() => ({ startGame: vi.fn() }));
vi.mock("../game/index.js", () => ({ startGame }));

function MatchProbe() {
  const { matchId } = useParams();
  const [searchParams] = useSearchParams();
  return (
    <div>
      Match page {matchId} {searchParams.get("me")}
    </div>
  );
}

function renderAtPlayRoute(props: React.ComponentProps<typeof GameCanvas> = {}) {
  return render(
    <MemoryRouter initialEntries={["/play"]}>
      <WithQuery>
        <Routes>
          <Route path="/" element={<div>Main Menu</div>} />
          <Route path="/play" element={<GameCanvas {...props} />} />
          <Route path="/match/:matchId" element={<MatchProbe />} />
          <Route path="/rewards" element={<RewardsRoute />} />
          <Route path="/scoreboard" element={<ScoreboardRoute />} />
        </Routes>
      </WithQuery>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The API surface the match overlays read: track names, one track detail, one rewards claim. */
const trackListStub = [
  { id: "t1", name: "Wobble Ramp" },
  { id: "t2", name: "Ice Caves" },
];

const trackDetailStub = {
  id: "t1",
  name: "Wobble Ramp",
  track: [
    { moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
    { moduleId: "checkpoint-spinner", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
    { moduleId: "checkpoint-end-props", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
  ],
};

const claimStub = {
  gainedXp: 240,
  gainedCoins: 36,
  xpBefore: 100,
  xpAfter: 340,
  coinsBefore: 10,
  coinsAfter: 46,
};

const balanceStub = { xp: 0, coins: 1240 };

const bettingStub = {
  matchId: "match-1",
  round: 1,
  open: true,
  closesAtMs: Date.now() + 18_000,
  settled: false,
  winnerIds: null,
  runners: [
    { playerId: "p2", nickname: "Rival", pool: 240, odds: 2 },
    { playerId: "p3", nickname: "Third", pool: 60, odds: 8 },
  ],
  totalPool: 300,
  bettorCount: 14,
  recentBets: [{ nickname: "MrBeano", amount: 500, targetNickname: "Rival", placedAtMs: 1 }],
};

interface ApiSeen {
  claimBodies: unknown[];
  betBodies: unknown[];
  betting: unknown;
}

const stubMatchApi = (seen: ApiSeen): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const method = (init.method ?? "GET").toUpperCase();
      if (url.endsWith("/rewards/claim")) {
        seen.claimBodies.push(JSON.parse(String(init.body)));
        return Response.json(claimStub);
      }
      if (url.endsWith("/rewards/me")) return Response.json(balanceStub);
      if (method === "POST" && url.endsWith("/bets")) {
        seen.betBodies.push(JSON.parse(String(init.body)));
        return Response.json({ betId: "bet-1", coins: 1140 });
      }
      if (method === "GET" && /\/bets\//.test(url)) return Response.json(seen.betting);
      if (/\/tracks\/[^/]+$/.test(url)) return Response.json(trackDetailStub);
      if (url.endsWith("/tracks")) return Response.json(trackListStub);
      throw new Error(`unstubbed API call in test: ${url}`);
    }),
  );
};

const freshSeen = (overrides: Partial<ApiSeen> = {}): ApiSeen => ({
  claimBodies: [],
  betBodies: [],
  // Fresh close per test, not per module load — a frozen closesAtMs would
  // read 0:0X by the time a later test's panel polls it.
  betting: { ...bettingStub, closesAtMs: Date.now() + 18_000 },
  ...overrides,
});

const lobbyPlayers = [
  { id: "me", nickname: "Mushy", ready: true, joinOrder: 0, accountId: null, bodySkin: null },
  { id: "p2", nickname: "Rival", ready: true, joinOrder: 1, accountId: null, bodySkin: null },
  { id: "p3", nickname: "Third", ready: true, joinOrder: 2, accountId: null, bodySkin: null },
];

const lobbyIn = (phase: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  myId: "me",
  matchId: "match-1",
  phase,
  matchOver: null,
  hostId: "me",
  players: lobbyPlayers,
  trackId: "t1",
  trackRevision: 1,
  timeLimitMs: 180_000,
  matchLength: 3,
  roundType: "race",
  roundPicks: [],
  ...extra,
});

const resultsRows = [
  { id: "me", nickname: "Mushy", qualified: true, placement: 1, checkpointIndex: 4, fallCount: 2, dnf: false },
  { id: "p2", nickname: "Rival", qualified: true, placement: 2, checkpointIndex: 3, fallCount: 1, dnf: false },
  { id: "p3", nickname: "Third", qualified: false, placement: 3, checkpointIndex: 1, fallCount: 5, dnf: false },
];

const standingsIn = (roundsRemaining: boolean): Record<string, unknown> => ({
  results: resultsRows,
  roundsRemaining,
  standings: [
    { id: "me", nickname: "Mushy", score: 300, placement: 1, gone: false, confirmed: false },
    { id: "p2", nickname: "Rival", score: 200, placement: 2, gone: false, confirmed: false },
    { id: "p3", nickname: "Third", score: 100, placement: 3, gone: false, confirmed: false },
  ],
  winners: [{ id: "me", score: 300 }],
});



interface MatchConfig {
  onLobbyState?: (state: unknown) => void;
  onStandings?: (snapshot: unknown) => void;
  onRunEnd?: (event: unknown) => void;
  onHitTaken?: (event: unknown) => void;
  onSpectate?: (snapshot: unknown) => void;
}

const bootMatch = async (): Promise<{
  reportLobby: (state: unknown) => void;
  reportStandings: (snapshot: unknown) => void;
  reportRunEnd: (event: unknown) => void;
  reportHitTaken: (event: unknown) => void;
  reportSpectate: (snapshot: unknown) => void;
  standingsReady: () => void;
  spectateFollow: ReturnType<typeof vi.fn>;
  spectatePrev: ReturnType<typeof vi.fn>;
  spectateNext: ReturnType<typeof vi.fn>;
  setFreeCam: ReturnType<typeof vi.fn>;
  enterSpectate: ReturnType<typeof vi.fn>;
}> => {
  let reportLobby!: (state: unknown) => void;
  let reportStandings!: (snapshot: unknown) => void;
  let reportRunEnd!: (event: unknown) => void;
  let reportHitTaken!: (event: unknown) => void;
  let reportSpectate!: (snapshot: unknown) => void;
  const standingsReady = vi.fn();
  const spectateFollow = vi.fn();
  const spectatePrev = vi.fn();
  const spectateNext = vi.fn();
  const setFreeCam = vi.fn();
  const enterSpectate = vi.fn();
  startGame.mockImplementationOnce(async (config: MatchConfig) => {
    reportLobby = config.onLobbyState!;
    reportStandings = config.onStandings!;
    reportRunEnd = config.onRunEnd!;
    reportHitTaken = config.onHitTaken!;
    reportSpectate = config.onSpectate!;
    return {
      stop: vi.fn(),
      setNickname: vi.fn(),
      setReady: vi.fn(),
      selectTrack: vi.fn(),
      start: vi.fn(),
      standingsReady,
      spectateFollow,
      spectatePrev,
      spectateNext,
      setFreeCam,
      enterSpectate,
    };
  });
  renderAtPlayRoute({ connection: { myId: "me" } as never });
  await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));
  return {
    reportLobby,
    reportStandings,
    reportRunEnd,
    reportHitTaken,
    reportSpectate,
    standingsReady,
    spectateFollow,
    spectatePrev,
    spectateNext,
    setFreeCam,
    enterSpectate,
  };
};

const runEndOut = {
  outcome: "out",
  placement: 2,
  playerCount: 3,
  qualified: false,
  points: 137,
  raceTimeMs: null,
  survivedMs: 272_000,
  checkpointIndex: 1,
};

const runEndFinished = {
  outcome: "finished",
  placement: 1,
  playerCount: 3,
  qualified: true,
  points: 242,
  raceTimeMs: 82_104,
  survivedMs: null,
  checkpointIndex: 2,
};

const spectateIn = {
  followingId: "p2",
  followingNickname: "Rival",
  followedPlace: 2,
  runners: [
    { id: "p2", nickname: "Rival" },
    { id: "p3", nickname: "Third" },
  ],
  beansLeft: 2,
  freeCam: false,
};

describe("GameCanvas", () => {
  it("boots the game once mounted, handing it its own div as the mount", async () => {
    const stop = vi.fn();
    startGame.mockResolvedValueOnce({ stop });

    renderAtPlayRoute({ trackId: "abc123" });

    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));
    const config = startGame.mock.calls[0]![0];
    expect(config.mount).toBeInstanceOf(HTMLElement);
    expect(config.trackId).toBe("abc123");
  });

  it("stops the running game on unmount", async () => {
    const stop = vi.fn();
    startGame.mockResolvedValueOnce({ stop });

    const { unmount } = renderAtPlayRoute();
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("stops the game immediately if unmounted before boot resolves, instead of leaking it", async () => {
    const stop = vi.fn();
    let resolveBoot!: (handle: { stop: () => void }) => void;
    startGame.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveBoot = resolve;
      }),
    );

    const { unmount } = renderAtPlayRoute();
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    unmount(); // boot is still in flight
    resolveBoot({ stop });
    await waitFor(() => expect(stop).toHaveBeenCalledOnce());
  });

  it("a rejected boot throws to the app-wide boundary — the connection screen, not a banner", async () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    startGame.mockRejectedValueOnce(new Error("server unreachable"));

    render(
      <MemoryRouter initialEntries={["/play"]}>
        <ErrorBoundary>
          <WithQuery>
            <Routes>
              <Route path="/" element={<div>Main Menu</div>} />
              <Route path="/play" element={<GameCanvas />} />
            </Routes>
          </WithQuery>
        </ErrorBoundary>
      </MemoryRouter>,
    );

    expect(await screen.findByText("CONNECTION LOST")).toBeInTheDocument();
    expect(screen.getByText("server unreachable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "TRY AGAIN" }));
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("CONNECTION LOST")).not.toBeInTheDocument();
    silence.mockRestore();
  });

  it("does not forward the exit immediately — the game freezes on its own last frame first", async () => {
    // game.ts's own design: it freezes on the last frame and shows a
    // "reload to rejoin" HUD message when the exit fires, expecting the
    // shell not to react until the player is done reading it. Forwarding
    // onExit immediately would navigate away and tear that down before
    // it's ever seen.
    const onExit = vi.fn();
    startGame.mockImplementationOnce(async (config: { onExit?: (reason: string) => void }) => {
      config.onExit?.("disconnected");
      return { stop: vi.fn() };
    });

    renderAtPlayRoute({ onExit });
    await screen.findByRole("button", { name: "Back to menu" });
    expect(onExit).not.toHaveBeenCalled();
  });

  it("forwards the game's own onExit reason to the caller once the player clicks Back to menu", async () => {
    const onExit = vi.fn();
    startGame.mockImplementationOnce(async (config: { onExit?: (reason: string) => void }) => {
      config.onExit?.("disconnected");
      return { stop: vi.fn() };
    });

    renderAtPlayRoute({ onExit });
    fireEvent.click(await screen.findByRole("button", { name: "Back to menu" }));
    expect(onExit).toHaveBeenCalledWith("disconnected");
  });

  it("does not reboot the game when only the onExit/onMatchEnd identity changes", async () => {
    const stop = vi.fn();
    startGame.mockResolvedValue({ stop });

    const { rerender } = renderAtPlayRoute({ trackId: "abc123", onExit: () => {} });
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    rerender(
      <MemoryRouter initialEntries={["/play"]}>
        <WithQuery>
          <Routes>
            <Route path="/" element={<div>Main Menu</div>} />
            <Route path="/play" element={<GameCanvas trackId="abc123" onExit={() => {}} />} />
          </Routes>
        </WithQuery>
      </MemoryRouter>,
    );

    expect(startGame).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  it("forwards a shell-owned connection to the game instead of dialing its own socket (ADR 0056)", async () => {
    const stop = vi.fn();
    startGame.mockResolvedValueOnce({ stop });
    const connection = { socket: {}, welcome: { playerId: "me" } };

    renderAtPlayRoute({ connection: connection as never });
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    const config = startGame.mock.calls[0]![0];
    expect(config.connection).toBe(connection);
  });

  it("renders no Lobby overlay of its own — the Lobby Screen lives on the route (ADR 0056)", async () => {
    let reportLobby!: (state: unknown) => void;
    startGame.mockImplementationOnce(async (config: { onLobbyState?: (state: unknown) => void }) => {
      reportLobby = config.onLobbyState!;
      return { stop: vi.fn(), setNickname: vi.fn(), setReady: vi.fn(), selectTrack: vi.fn(), start: vi.fn() };
    });

    renderAtPlayRoute();
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    // Flush the LOBBY report through React, then assert: the roster arrived
    // (phase state updated — the Standings gate below reads it) and still no
    // Lobby overlay rendered. LOBBY belongs to the route's own Screen; this
    // canvas only boots once the Match starts.
    await act(async () => {
      reportLobby({
        myId: "me",
  matchId: "match-1",
        phase: "LOBBY",
        hostId: "me",
        players: [{ id: "me", nickname: "Player", ready: false, joinOrder: 0, accountId: null, bodySkin: null }],
        trackId: "t1",
        trackRevision: 1,
        timeLimitMs: 180_000,
        matchLength: 1,
        roundPicks: [],
      });
    });
    expect(screen.queryByText("LOBBY")).not.toBeInTheDocument();
  });

  it("shows the Countdown overlay over the live canvas while the Round loads", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900 }));
    });

    expect(await screen.findByText("ROUND 1 OF 3")).toBeInTheDocument();
    expect(screen.getByText("WOBBLE RAMP")).toBeInTheDocument();
    expect(screen.getByText("RACE")).toBeInTheDocument();
    expect(screen.getByText("CHECKPOINT 00 / 02")).toBeInTheDocument();
    expect(screen.getByText("GRID SPOT")).toBeInTheDocument();
    // The beat is the server's remaining ms, not a looping animation: 2.9s
    // in shows 3, and each later snapshot swaps the single live numeral.
    expect(screen.getByRole("status", { name: "3" })).toBeInTheDocument();
    expect(seen.claimBodies).toHaveLength(0);

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 900 }));
    });
    expect(screen.getByRole("status", { name: "1" })).toBeInTheDocument();

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 0 }));
    });
    expect(screen.getByRole("status", { name: "GO!" })).toBeInTheDocument();
  });

  it("shows BetweenRounds mid-Match, and flipping Ready confirms into the Loading screen", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportStandings, standingsReady } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900 }));
    });
    expect(await screen.findByText("ROUND 1 OF 3")).toBeInTheDocument();

    await act(async () => {
      reportLobby(lobbyIn("RESULTS"));
      reportStandings(standingsIn(true));
    });

    expect(await screen.findByText("ROUND 1 DONE")).toBeInTheDocument();
    expect(screen.getByText("2 ROUNDS LEFT")).toBeInTheDocument();
    expect(screen.getByText("Wobble Ramp \u00b7 RACE")).toBeInTheDocument();
    expect(screen.getByText("Mushy")).toBeInTheDocument();
    expect(screen.getByText("0 OF 3 READY")).toBeInTheDocument();
    expect(screen.getByText("NEXT UP \u00b7 ROUND 2")).toBeInTheDocument();
    expect(screen.getByText("UNREVEALED")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch"));
    expect(standingsReady).toHaveBeenCalledOnce();
    expect(await screen.findByText("Loading next Round\u2026")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("BetweenRounds SCOREBOARD opens the carried table as AFTER ROUND 1", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportStandings } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900 }));
    });
    expect(await screen.findByText("ROUND 1 OF 3")).toBeInTheDocument();
    await act(async () => {
      reportLobby(lobbyIn("RESULTS"));
      reportStandings(standingsIn(true));
    });

    fireEvent.click(await screen.findByRole("button", { name: "SCOREBOARD" }));
    expect(await screen.findByText("AFTER ROUND 1")).toBeInTheDocument();
    expect(screen.getByText("Mushy")).toBeInTheDocument();
    expect(screen.getByText("Rival")).toBeInTheDocument();
  });

  it("navigates to the results page once the server saved the finished Match", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportStandings } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900 }));
    });
    expect(await screen.findByText("ROUND 1 OF 3")).toBeInTheDocument();

    await act(async () => {
      reportLobby(lobbyIn("RESULTS", { matchOver: { matchId: "match-1" } }));
      reportStandings(standingsIn(false));
    });

    // The canvas unmounts behind the navigation — the Match page owns the screen now.
    expect(await screen.findByText("Match page match-1 me")).toBeInTheDocument();
  });

  it("shows a saving notice at a terminal RESULTS whose save hasn't landed", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportStandings } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900 }));
      reportLobby(lobbyIn("RESULTS"));
      reportStandings(standingsIn(false));
    });

    expect(await screen.findByText("Saving results…")).toBeInTheDocument();
    expect(screen.queryByText(/Match page/)).not.toBeInTheDocument();
  });

  it("clears the saving notice when the phase leaves RESULTS", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportStandings } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900 }));
      reportLobby(lobbyIn("RESULTS"));
      reportStandings(standingsIn(false));
    });
    expect(await screen.findByText("Saving results…")).toBeInTheDocument();

    await act(async () => {
      reportLobby(lobbyIn("LOBBY"));
    });
    await waitFor(() => expect(screen.queryByText("Saving results…")).not.toBeInTheDocument());
  });

  it("holds the Countdown overlay on green GO! into the Round, then drops it", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900 }));
    });
    expect(await screen.findByText("ROUND 1 OF 3")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "3" })).toBeInTheDocument();

    await act(async () => {
      reportLobby(lobbyIn("RUNNING"));
    });
    expect(await screen.findByRole("status", { name: "GO!" })).toBeInTheDocument();

    await waitFor(
      () => expect(screen.queryByRole("status", { name: "GO!" })).not.toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it("flashes YOU GOT HIT mid-Round on a landing, then drops it after one beat", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportHitTaken } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900 }));
    });
    expect(await screen.findByText("ROUND 1 OF 3")).toBeInTheDocument();
    await act(async () => {
      reportLobby(lobbyIn("RUNNING"));
      reportHitTaken({ knockedDown: false });
    });

    expect(await screen.findByRole("status", { name: "YOU GOT HIT" })).toBeInTheDocument();
    await waitFor(
      () => expect(screen.queryByRole("status", { name: "YOU GOT HIT" })).not.toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it("reads KNOCKED DOWN when the same Hit downed you", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportHitTaken } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("RUNNING"));
      reportHitTaken({ knockedDown: true });
    });

    expect(await screen.findByRole("status", { name: "KNOCKED DOWN" })).toBeInTheDocument();
  });

  it("a second landing while the flash still shows replays instead of being swallowed", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportHitTaken } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("RUNNING"));
      reportHitTaken({ knockedDown: false });
    });
    expect(await screen.findByRole("status", { name: "YOU GOT HIT" })).toBeInTheDocument();

    await act(async () => {
      reportHitTaken({ knockedDown: true });
    });
    expect(await screen.findByRole("status", { name: "KNOCKED DOWN" })).toBeInTheDocument();
  });

  it("never flashes outside RUNNING — a stray event can't haunt the Countdown", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportHitTaken } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900 }));
      reportHitTaken({ knockedDown: false });
    });

    expect(await screen.findByText("ROUND 1 OF 3")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "YOU GOT HIT" })).not.toBeInTheDocument();
  });

  it("slams the KNOCKED OUT verdict mid-Round with the run's own facts", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportRunEnd } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900 }));
    });
    expect(await screen.findByText("ROUND 1 OF 3")).toBeInTheDocument();
    await act(async () => {
      reportLobby(lobbyIn("RUNNING"));
      reportRunEnd(runEndOut);
    });

    expect(await screen.findByText("KNOCKED OUT")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("SURVIVED")).toBeInTheDocument();
    expect(screen.getByText("4:32")).toBeInTheDocument();
    expect(screen.getByText("+137")).toBeInTheDocument();
    expect(screen.getByText("NEXT ROUND IN 3:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SPECTATE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "LEAVE" })).toBeInTheDocument();
    // Mid-Round there is no standings table yet — no button to a nowhere.
    expect(screen.queryByRole("button", { name: "SCOREBOARD" })).not.toBeInTheDocument();
  });

  it("slams FINISHED with race time, and SPECTATE opts the finisher into spectating", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportRunEnd, enterSpectate } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900 }));
    });
    expect(await screen.findByText("ROUND 1 OF 3")).toBeInTheDocument();
    await act(async () => {
      reportLobby(lobbyIn("RUNNING"));
      reportRunEnd(runEndFinished);
    });

    expect(await screen.findByText("FINISHED")).toBeInTheDocument();
    expect(screen.getByText("1ST")).toBeInTheDocument();
    expect(screen.getByText("01:22.104")).toBeInTheDocument();
    expect(screen.getByText("+242")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "SPECTATE" }));
    expect(enterSpectate).toHaveBeenCalledOnce();
    expect(screen.queryByText("FINISHED")).not.toBeInTheDocument();
  });

  it("SPECTATE swaps the verdict for the live panel, and STAKE posts one ticket", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportRunEnd, reportSpectate } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900 }));
    });
    expect(await screen.findByText("ROUND 1 OF 3")).toBeInTheDocument();
    await act(async () => {
      reportLobby(lobbyIn("RUNNING"));
      reportRunEnd(runEndOut);
    });
    expect(await screen.findByText("KNOCKED OUT")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "SPECTATE" }));
    await act(async () => {
      reportSpectate(spectateIn);
    });

    expect(await screen.findByText("SPECTATING")).toBeInTheDocument();
    expect(screen.queryByText("KNOCKED OUT")).not.toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("YOU WENT OUT #2")).toBeInTheDocument();
    expect(screen.getByText("02 BEANS LEFT")).toBeInTheDocument();
    expect(screen.getByText("ROUND 1 \u00b7 RACE")).toBeInTheDocument();
    // Live board, not mock runners: pools, pari-mutuel odds, ticker, close.
    expect(screen.getByText("\u00d72.0")).toBeInTheDocument();
    expect(screen.getByText("\u00d78.0")).toBeInTheDocument();
    expect(screen.getByText("FAVOURITE")).toBeInTheDocument();
    expect(screen.getByText("MRBEANO STAKED 500 ON RIVAL")).toBeInTheDocument();
    expect(screen.getByText("14 SPECTATORS BETTING")).toBeInTheDocument();
    expect(screen.getByText(/CLOSES 0:/)).toBeInTheDocument();
    expect(screen.getByText("1 240")).toBeInTheDocument();

    // The button's accessible name carries its sub-line ("STAKE 100 ON RIVAL · WINS 200").
    fireEvent.click(screen.getByRole("button", { name: /^STAKE 100/ }));
    await waitFor(() => expect(seen.betBodies).toHaveLength(1));
    expect(seen.betBodies[0]).toEqual({ matchId: "match-1", round: 1, targetId: "p2", amount: 100 });
  });

  it("the panel follows beans and holds the camera through the handle", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportSpectate, spectateFollow, spectatePrev, spectateNext, setFreeCam } =
      await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900 }));
    });
    expect(await screen.findByText("ROUND 1 OF 3")).toBeInTheDocument();
    // No run-end: a mid-Match joiner spectates with no verdict before it.
    await act(async () => {
      reportLobby(lobbyIn("RUNNING"));
      reportSpectate(spectateIn);
    });

    expect(await screen.findByText("SPECTATING")).toBeInTheDocument();
    expect(screen.queryByText("KNOCKED OUT")).not.toBeInTheDocument();
    // A joiner has no exit — no chip at all, never the mock default.
    expect(screen.queryByText(/YOU (WENT OUT|FINISHED)/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Spectate Third" }));
    expect(spectateFollow).toHaveBeenCalledWith("p3");
    fireEvent.click(screen.getByRole("button", { name: "Spectate previous bean" }));
    expect(spectatePrev).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Spectate next bean" }));
    expect(spectateNext).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "FREE CAM" }));
    expect(setFreeCam).toHaveBeenCalledWith(true);
  });

  it("a closed board reads CLOSED and refuses stakes", async () => {
    const seen = freshSeen({ betting: { ...bettingStub, open: false } });
    stubMatchApi(seen);
    const { reportLobby, reportRunEnd, reportSpectate } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900 }));
    });
    expect(await screen.findByText("ROUND 1 OF 3")).toBeInTheDocument();
    await act(async () => {
      reportLobby(lobbyIn("RUNNING"));
      reportRunEnd(runEndOut);
    });
    expect(await screen.findByText("KNOCKED OUT")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "SPECTATE" }));
    await act(async () => {
      reportSpectate(spectateIn);
    });

    expect(await screen.findByText("CLOSED")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /STAKE/ })).toBeDisabled();
    expect(seen.betBodies).toHaveLength(0);
  });

  it("the verdict leaves with the Round — RESULTS shows standings, not the slam", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportRunEnd, reportStandings } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900 }));
    });
    expect(await screen.findByText("ROUND 1 OF 3")).toBeInTheDocument();
    await act(async () => {
      reportLobby(lobbyIn("RUNNING"));
      reportRunEnd(runEndOut);
    });
    expect(await screen.findByText("KNOCKED OUT")).toBeInTheDocument();

    await act(async () => {
      reportLobby(lobbyIn("RESULTS"));
      reportStandings(standingsIn(true));
    });
    await waitFor(() => expect(screen.queryByText("KNOCKED OUT")).not.toBeInTheDocument());
    expect(screen.getByText("ROUND 1 DONE")).toBeInTheDocument();
  });

  it("tears down the old game and boots a new one when trackId changes", async () => {
    const stopFirst = vi.fn();
    const stopSecond = vi.fn();
    startGame.mockResolvedValueOnce({ stop: stopFirst }).mockResolvedValueOnce({ stop: stopSecond });

    const { rerender } = renderAtPlayRoute({ trackId: "abc123" });
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    rerender(
      <MemoryRouter initialEntries={["/play"]}>
        <WithQuery>
          <Routes>
            <Route path="/" element={<div>Main Menu</div>} />
            <Route path="/play" element={<GameCanvas trackId="def456" />} />
          </Routes>
        </WithQuery>
      </MemoryRouter>,
    );

    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(2));
    expect(stopFirst).toHaveBeenCalledOnce();
  });
});

describe("GameCanvas practice mode (m8.1 tickets 01+03)", () => {
  it("boots a practice session — practice flag plus onPracticeState, never a Lobby", async () => {
    startGame.mockResolvedValue({ stop: vi.fn() });

    renderAtPlayRoute({ trackId: "abc123", practice: true });
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    const config = startGame.mock.calls[0]![0];
    expect(config.trackId).toBe("abc123");
    expect(config.practice).toBe(true);
    expect(typeof config.onPracticeState).toBe("function");
    // No Lobby overlay in a practice session — nothing match-shaped renders.
    expect(screen.queryByText("Lobby")).not.toBeInTheDocument();
  });

  it("renders the practice hint bar once the session reports its Track, then the finish toast", async () => {
    let reportPractice!: (snapshot: PracticeSnapshot) => void;
    startGame.mockImplementationOnce(
      async (config: { onPracticeState?: (snapshot: PracticeSnapshot) => void }) => {
        reportPractice = config.onPracticeState!;
        return { stop: vi.fn() };
      },
    );

    renderAtPlayRoute({ trackId: "abc123", practice: true });
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    reportPractice({ trackName: "Asset demo", finished: false, bindings: DEFAULT_BINDINGS });
    expect(await screen.findByText("Asset demo")).toBeInTheDocument();
    expect(screen.getByText(/WASD move/)).toBeInTheDocument();
    expect(screen.queryByText(/Finished — keep running/)).not.toBeInTheDocument();

    reportPractice({ trackName: "Asset demo", finished: true, bindings: DEFAULT_BINDINGS });
    expect(await screen.findByText("Finished — keep running")).toBeInTheDocument();
  });

  it("leaves through the existing onExit path on Back click and on Esc, disposing the session on unmount", async () => {
    const onExit = vi.fn();
    const stop = vi.fn();
    let reportPractice!: (snapshot: PracticeSnapshot) => void;
    startGame.mockImplementationOnce(
      async (config: { onPracticeState?: (snapshot: PracticeSnapshot) => void }) => {
        reportPractice = config.onPracticeState!;
        return { stop };
      },
    );

    const { unmount } = renderAtPlayRoute({ trackId: "abc123", practice: true, onExit });
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));
    reportPractice({ trackName: "Asset demo", finished: false, bindings: DEFAULT_BINDINGS });
    expect(await screen.findByText("Asset demo")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onExit).toHaveBeenCalledWith("disconnected");

    fireEvent.keyDown(window, { code: "Escape" });
    expect(onExit).toHaveBeenCalledTimes(2);

    unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("reports a practice boot failure as a Track load error, not a connection error", async () => {
    startGame.mockRejectedValueOnce(new Error("could not fetch Track abc123 from the API: HTTP 404"));

    renderAtPlayRoute({ trackId: "abc123", practice: true });

    expect(await screen.findByText(/failed to load Track/)).toBeInTheDocument();
    expect(screen.getByText(/could not fetch Track/)).toBeInTheDocument();
  });

  it("a practice boot is not a game start — only a Match boot hides the social alerts", async () => {
    startGame.mockResolvedValue({ stop: vi.fn() });

    const practice = renderAtPlayRoute({ trackId: "abc123", practice: true });
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));
    expect(getGameActiveSnapshot()).toBe(false);
    practice.unmount();

    const match = renderAtPlayRoute({ trackId: "abc123" });
    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(2));
    expect(getGameActiveSnapshot()).toBe(true);
    match.unmount();
    expect(getGameActiveSnapshot()).toBe(false);
  });
});
