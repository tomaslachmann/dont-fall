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
      if (url.endsWith("/personal-best")) return Response.json({ bestMs: 79_904 });
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
  { id: "me", nickname: "Mushy", ready: true, joinOrder: 0, accountId: null, color: null },
  { id: "p2", nickname: "Rival", ready: true, joinOrder: 1, accountId: null, color: null },
  { id: "p3", nickname: "Third", ready: true, joinOrder: 2, accountId: null, color: null },
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
  loaded: ["me", "p2", "p3"],
  timeLimitMs: 180_000,
  matchLength: 3,
  // The server's Round number (ADR 0110): none yet in LOBBY, Round 1 after.
  round: phase === "LOBBY" ? 0 : 1,
  roundType: "race",
  roundPicks: [],
  ...extra,
});

const resultsRows = [
  { id: "me", nickname: "Mushy", qualified: true, placement: 1, checkpointIndex: 4, fallCount: 2, dnf: false },
  { id: "p2", nickname: "Rival", qualified: true, placement: 2, checkpointIndex: 3, fallCount: 1, dnf: false },
  { id: "p3", nickname: "Third", qualified: false, placement: 3, checkpointIndex: 1, fallCount: 5, dnf: false },
];

const standingsIn = (roundsRemaining: boolean, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  results: resultsRows,
  roundsRemaining,
  standings: [
    { id: "me", nickname: "Mushy", score: 300, placement: 1, gone: false, confirmed: false, gained: 300, previousPlacement: null },
    { id: "p2", nickname: "Rival", score: 200, placement: 2, gone: false, confirmed: false, gained: 200, previousPlacement: null },
    { id: "p3", nickname: "Third", score: 100, placement: 3, gone: false, confirmed: false, gained: 100, previousPlacement: null },
  ],
  winners: [{ id: "me", score: 300 }],
  autoStartAtMs: null,
  ...extra,
});



interface MatchConfig {
  onLobbyState?: (state: unknown) => void;
  onStandings?: (snapshot: unknown) => void;
  onRunEnd?: (event: unknown) => void;
  onHitTaken?: (event: unknown) => void;
  onSpectate?: (snapshot: unknown) => void;
  onRoundHud?: (snapshot: unknown) => void;
  onWorldReady?: (ready: boolean) => void;
}

const bootMatch = async (): Promise<{
  reportLobby: (state: unknown) => void;
  reportStandings: (snapshot: unknown) => void;
  reportRunEnd: (event: unknown) => void;
  reportHitTaken: (event: unknown) => void;
  reportSpectate: (snapshot: unknown) => void;
  reportRoundHud: (snapshot: unknown) => void;
  /** ADR 0089: the game reporting its own world built (or being rebuilt) — the boot below fires it once, like a real client. */
  reportWorldReady: (ready: boolean) => void;
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
  let reportRoundHud!: (snapshot: unknown) => void;
  let reportWorldReady!: (ready: boolean) => void;
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
    reportRoundHud = config.onRoundHud!;
    reportWorldReady = config.onWorldReady!;
    return {
      stop: vi.fn(),
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
  // A real client's world lands a moment after the boot resolves (ADR 0089);
  // without it every test would sit behind the Round loader.
  await act(async () => {
    reportWorldReady(true);
  });
  return {
    reportLobby,
    reportStandings,
    reportRunEnd,
    reportHitTaken,
    reportSpectate,
    reportRoundHud,
    reportWorldReady,
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
  outBy: { nickname: "Rival", how: "grabbed" },
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
  outBy: null,
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
  aliveForMs: 65_000,
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
      return { stop: vi.fn(), setReady: vi.fn(), selectTrack: vi.fn(), start: vi.fn() };
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
        players: [{ id: "me", nickname: "Player", ready: false, joinOrder: 0, accountId: null, color: null }],
        trackId: "t1",
        trackRevision: 1,
        timeLimitMs: 180_000,
        matchLength: 1,
        roundPicks: [],
      });
    });
    expect(screen.queryByText("LOBBY")).not.toBeInTheDocument();
  });

  it("the Countdown's grid spot is your place in the line among those here, never above the field (ADR 0110)", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby } = await bootMatch();
    await act(async () => {
      reportLobby(
        lobbyIn("COUNTDOWN", {
          countdownMsLeft: 2900,
          players: [
            { id: "p2", nickname: "Rival", ready: true, joinOrder: 2, accountId: null, color: null },
            { id: "me", nickname: "Mushy", ready: true, joinOrder: 9, accountId: "acc-me", color: 2 },
          ],
        }),
      );
    });
    expect(await screen.findByText("02")).toBeInTheDocument();
    // ADR 0110: the line draws each Player's own Account picture.
    expect(document.querySelector('img[src$="/avatars/acc-me"]')).not.toBeNull();
    expect(screen.getByText("/2")).toBeInTheDocument();
    // Two on the line, both drawn: no "+0" bubble.
    expect(screen.queryByText("+0")).not.toBeInTheDocument();
  });

  it("a Survival Countdown shows no Checkpoint row and wears Survival's chip (ADR 0110)", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby } = await bootMatch();
    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900, roundType: "survival" }));
    });
    expect(await screen.findByText("SURVIVAL")).toBeInTheDocument();
    expect(screen.queryByText(/CHECKPOINT/)).not.toBeInTheDocument();
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
    // The Round loader, naming what it waits on — the next Track is still undrawn.
    expect(await screen.findByRole("status")).toHaveTextContent(/WAITING FOR PLAYERS \d\/3/);
    expect(screen.getByRole("heading", { name: "UNREVEALED" })).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("BetweenRounds SCOREBOARD opens the table over the Match, and BACK returns to it (ADR 0110)", async () => {
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
    // BACK lands on the same Standings: the canvas (and its socket) never unmounted.
    fireEvent.click(screen.getByRole("button", { name: "BACK" }));
    expect(await screen.findByText("ROUND 1 DONE")).toBeInTheDocument();
  });

  it("BetweenRounds keeps this Round's gains, counts only who is still here, and counts down to the server's deadline (ADR 0110)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const seen = freshSeen();
      stubMatchApi(seen);
      const { reportLobby, reportStandings } = await bootMatch();
      await act(async () => {
        reportLobby(lobbyIn("RESULTS"));
        reportStandings(
          standingsIn(true, {
            standings: [
              { id: "me", nickname: "Mushy", score: 166.67, placement: 1, gone: false, confirmed: true, gained: 66.67, previousPlacement: 2 },
              { id: "p2", nickname: "Rival", score: 150, placement: 2, gone: false, confirmed: false, gained: 50, previousPlacement: 1 },
              { id: "p3", nickname: "Third", score: 100, placement: 3, gone: true, confirmed: false, gained: 0, previousPlacement: 3 },
            ],
            autoStartAtMs: Date.now() + 14_000,
          }),
        );
      });
      expect(await screen.findByText("+67")).toBeInTheDocument();
      expect(screen.getByText("167")).toBeInTheDocument();
      expect(screen.getByText("1 OF 2 READY")).toBeInTheDocument();
      expect(screen.getByText("AUTO-START IN 0:14")).toBeInTheDocument();

      // The half-second clock re-renders: the gains stay what the server says.
      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });
      expect(screen.getByText("+67")).toBeInTheDocument();
      expect(screen.getByText("AUTO-START IN 0:12")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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

    expect(await screen.findByText("SAVING RESULTS…")).toBeInTheDocument();
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
    expect(await screen.findByText("SAVING RESULTS…")).toBeInTheDocument();

    await act(async () => {
      reportLobby(lobbyIn("LOBBY"));
    });
    await waitFor(() => expect(screen.queryByText("SAVING RESULTS…")).not.toBeInTheDocument());
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

  it("holds the Round behind the Track's own loading Screen until this client's world is built (ADR 0089)", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportWorldReady } = await bootMatch();

    await act(async () => {
      reportWorldReady(false);
      reportLobby(lobbyIn("LOADING"));
    });

    expect(await screen.findByText("LOADING TRACK…")).toBeInTheDocument();
    expect(screen.getByText("WOBBLE RAMP")).toBeInTheDocument();

    // Ready here, but the Round still waits for everyone else's world.
    await act(async () => {
      reportWorldReady(true);
      reportLobby(lobbyIn("LOADING", { loaded: ["me"] }));
    });
    expect(screen.getByText("WAITING FOR PLAYERS 1/3")).toBeInTheDocument();

    // The server starts the Countdown once everyone has reported.
    await act(async () => {
      reportLobby(lobbyIn("COUNTDOWN", { countdownMsLeft: 2900 }));
    });
    expect(screen.queryByText("WAITING FOR PLAYERS 1/3")).not.toBeInTheDocument();
    expect(await screen.findByText("ROUND 1 OF 3")).toBeInTheDocument();
  });

  it("knows the Round's Track from the route's own snapshot before the game has raised one, picture and all (ADR 0105)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.endsWith("/tracks")) {
          return Response.json([
            { id: "t1", name: "Wobble Ramp", revision: 4, hasThumbnail: true, authorId: "a1", createdAt: 1, plays: 0, hasFinishZone: true },
          ]);
        }
        if (/\/tracks\/[^/]+$/.test(url)) return Response.json(trackDetailStub);
        return Response.json({ bestMs: null });
      }),
    );
    // The game module is still loading: it has raised nothing at all.
    startGame.mockImplementationOnce(() => new Promise(() => {}));

    const { container } = renderAtPlayRoute({ connection: { myId: "me" } as never, lobbyAtHandover: lobbyIn("LOADING") as never });

    expect(await screen.findByRole("heading", { name: "WOBBLE RAMP" })).toBeInTheDocument();
    expect(screen.getByText("ROUND 1 OF 3")).toBeInTheDocument();
    expect(screen.getByText("RACE")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("LOADING TRACK…");
    const stage = container.querySelector<HTMLElement>("[data-df-feel]")!;
    expect(stage.style.getPropertyValue("--df-track-art")).toBe('url("http://localhost:8081/tracks/t1/thumbnail?revision=4")');
  });

  it("puts the loading Screen back while a client rebuilds its world for another Track", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportWorldReady } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("RUNNING"));
    });
    expect(screen.queryByText("LOADING TRACK…")).not.toBeInTheDocument();

    await act(async () => {
      reportWorldReady(false);
    });
    expect(screen.getByText("LOADING TRACK…")).toBeInTheDocument();
  });

  const raceHudIn = {
    kind: "race",
    place: 2,
    field: 3,
    elapsedMs: 84_300,
    checkpointsReached: 4,
    checkpoints: 7,
    splitMs: 2478,
    threat: { id: "p2", nickname: "Rival" },
    dashCharge: 0.4,
    dashReady: false,
    dashRechargeS: 9,
    dashKey: "SHIFT",
  };

  it("draws the Race HUD over a running Race once GO! has had its beat (ADR 0088)", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportRoundHud } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("RUNNING"));
      reportRoundHud(raceHudIn);
    });

    expect(await screen.findByText("RIVAL IS RIGHT BEHIND YOU", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("+2.478")).toBeInTheDocument();
    expect(screen.getByText("CHECKPOINT 04 / 07")).toBeInTheDocument();
    expect(screen.getByText("/3")).toBeInTheDocument();
    expect(await screen.findByText("PB 01:19.904")).toBeInTheDocument();
    // ADR 0110: the Dash as the design's charge card.
    expect(screen.getByText("RECHARGES IN 9s")).toBeInTheDocument();
    expect(screen.getByText("PRESS SHIFT")).toBeInTheDocument();
  });

  it("gives the Race HUD's place to the verdict once your run ends", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportRoundHud, reportRunEnd } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("RUNNING"));
      reportRoundHud(raceHudIn);
    });
    expect(await screen.findByText("RIVAL IS RIGHT BEHIND YOU", {}, { timeout: 3000 })).toBeInTheDocument();

    await act(async () => {
      reportRunEnd(runEndFinished);
    });
    expect(await screen.findByText("FINISHED")).toBeInTheDocument();
    expect(screen.queryByText("RIVAL IS RIGHT BEHIND YOU")).not.toBeInTheDocument();
  });

  it("draws the Survival HUD — a count, who went last, and the danger warning when critical", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportRoundHud } = await bootMatch();

    await act(async () => {
      reportLobby(lobbyIn("RUNNING"));
      reportRoundHud({
        kind: "survival",
        remaining: 2,
        startedWith: 4,
        alive: ["me", "p2"],
        youAlive: true,
        survivedMs: 272_000,
        lastOut: "Third",
        lastOutLeft: false,
        critical: true,
        dashCharge: 1,
        dashReady: true,
        dashRechargeS: 0,
        dashKey: "Shift",
      });
    });

    expect(await screen.findByText("BEANS LEFT", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("STARTED WITH 4")).toBeInTheDocument();
    expect(screen.getByText("4:32")).toBeInTheDocument();
    expect(screen.getByText("THIRD WAS ELIMINATED")).toBeInTheDocument();
    expect(screen.getByText("CRITICAL ZONE")).toBeInTheDocument();
    expect(screen.getByText("READY")).toBeInTheDocument();
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
    expect(screen.getByText("ROUND ENDS IN 3:00")).toBeInTheDocument();
    // ADR 0110: who put you out, off the server's credit.
    expect(screen.getByText("GRABBED BY")).toBeInTheDocument();
    expect(screen.getByText("RIVAL")).toBeInTheDocument();
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
    // Against the Personal Best the Round started with: 82.104 s vs 79.904 s.
    expect(await screen.findByText("+2.2")).toBeInTheDocument();
    expect(screen.getByText("OFF YOUR PB")).toBeInTheDocument();

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
    // ALIVE FOR is the server's Round clock, not a stopwatch this page started.
    expect(screen.getByText("1:05")).toBeInTheDocument();
    expect(screen.getByText("02 BEANS LEFT")).toBeInTheDocument();
    expect(screen.getByText("ROUND 1 \u00b7 RACE")).toBeInTheDocument();
    // Live board, not mock runners: pools, pari-mutuel odds, ticker, close.
    expect(screen.getByText("\u00d72.0")).toBeInTheDocument();
    expect(screen.getByText("\u00d78.0")).toBeInTheDocument();
    expect(screen.getByText("FAVOURITE")).toBeInTheDocument();
    expect(screen.getByText("MRBEANO STAKED 500 ON RIVAL")).toBeInTheDocument();
    expect(screen.getByText("14 SPECTATORS BETTING")).toBeInTheDocument();
    expect(screen.getByText("CLOSES AT 1 LEFT")).toBeInTheDocument();
    expect(screen.getByText("1 240")).toBeInTheDocument();

    // The button's accessible name carries its sub-line ("STAKE 100 ON RIVAL · WINS 200").
    fireEvent.click(screen.getByRole("button", { name: /^STAKE 100/ }));
    await waitFor(() => expect(seen.betBodies).toHaveLength(1));
    expect(seen.betBodies[0]).toEqual({ matchId: "match-1", round: 1, targetId: "p2", amount: 100 });
  });

  it("a client that joins mid-Match reads the server's Round, and bets on it (ADR 0110)", async () => {
    const seen = freshSeen();
    stubMatchApi(seen);
    const { reportLobby, reportRunEnd, reportSpectate } = await bootMatch();

    // No COUNTDOWN was ever seen here — the first snapshot is Round 2 RUNNING.
    await act(async () => {
      reportLobby(lobbyIn("RUNNING", { round: 2 }));
      reportRunEnd(runEndOut);
    });
    fireEvent.click(await screen.findByRole("button", { name: "SPECTATE" }));
    await act(async () => {
      reportSpectate(spectateIn);
    });
    expect(await screen.findByText("ROUND 2 \u00b7 RACE")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^STAKE 100/ }));
    await waitFor(() => expect(seen.betBodies).toHaveLength(1));
    expect(seen.betBodies[0]).toEqual({ matchId: "match-1", round: 2, targetId: "p2", amount: 100 });
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
