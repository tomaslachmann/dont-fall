// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { LobbySnapshot } from "../lib/socket/lobbyConnection.js";
import { clearFlashes } from "../lib/flash.js";
import FlashHost from "../ui/FlashHost.js";
import Lobby, { type LobbyProps } from "./Lobby";
import { WithQuery } from "../test/query.js";

// The host's own effect fetches the API's Track list on mount —
// stubbed by default so tests that don't care about it never hit a real
// (nonexistent, in this test environment) network address.
beforeEach(() => {
  clearFlashes();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
});

// Who is talking (ADR 0111). The room itself is the voice socket's, and this
// Screen only reads it — so the reading is what is tested here, and the socket
// has its own suite.
let speakingNow: string[] = [];
vi.mock("../lib/voice/session.js", () => ({
  useVoiceRoom: () => ({
    connected: true,
    linked: speakingNow,
    speaking: speakingNow,
    isSpeaking: (accountId: string) => speakingNow.includes(accountId),
  }),
}));
beforeEach(() => {
  speakingNow = [];
});

// The logged-in Account is what names this Player in the roster (ADR 0052).
vi.mock("../lib/hooks/useAccount.js", () => ({
  useAccount: () => ({
    status: "authed",
    account: { id: "a1", discordId: null, email: null, displayName: "Wobbleton", avatarUrl: null, xp: 0, coins: 0 },
    recheck: () => {},
  }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
});

const baseLobby = (overrides: Partial<LobbySnapshot> = {}): LobbySnapshot => ({
  myId: "host-id",
  matchId: "match-1",
  phase: "LOBBY",
  matchOver: null,
  hostId: "host-id",
  players: [
    { id: "host-id", nickname: "Host Player", ready: false, joinOrder: 0, accountId: null, color: null, skin: null, hat: null },
    { id: "guest-id", nickname: "Guest", ready: true, joinOrder: 1, accountId: null, color: null, skin: null, hat: null },
  ],
  trackId: "track-a",
  loaded: [],
  trackRevision: 1,
  timeLimitMs: 180_000,
  roundType: "race",
  survivorTarget: 1,
  startBlockedReason: undefined,
  countdownMsLeft: 0,
  matchLength: 1,
  round: 0,
  roundPicks: [],
  bots: { enabled: false, max: 9, level: "normal" },
  maxPlayers: 10,
  ...overrides,
});

const noop = () => {};

/** Every callback defaults to a no-op, so each test only names the one it asserts on. */
const renderLobby = (props: Partial<LobbyProps> = {}) =>
  render(
    <MemoryRouter>
      {/* The shell mounts the flash stack above the routes — this test does the same. */}
      <FlashHost />
      <WithQuery><Lobby
        lobby={baseLobby()}
        onSetReady={noop}
        onSelectTrack={noop}
        onSetRoundType={noop}
        onSetMatchLength={noop}
        onPickRoundSlot={noop}
        onSetBots={noop}
        onStart={noop}
        {...props}
      /></WithQuery>
    </MemoryRouter>,
  );

describe("Lobby", () => {
  it("lists every connected Player, marking the host row", () => {
    renderLobby();

    expect(screen.getByText("Host Player")).toBeInTheDocument();
    expect(screen.getByText("Guest")).toBeInTheDocument();
    expect(screen.getByText("HOST")).toBeInTheDocument();
  });

  it("counts the room against the server's own capacity, not a guessed constant", () => {
    renderLobby({ lobby: baseLobby({ maxPlayers: 16 }) });

    expect(screen.getByText("/16")).toBeInTheDocument();
    expect(screen.getByText("14 SLOTS OPEN")).toBeInTheDocument();
  });

  it("lets this Player toggle their own Ready state — and offers no control for anyone else's", () => {
    const onSetReady = vi.fn();
    renderLobby({ onSetReady });

    // One switch, this Player's own. Everyone else's Ready is a chip.
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(1);
    fireEvent.click(switches[0]!);
    expect(onSetReady).toHaveBeenCalledWith(true);

    expect(screen.getByText("1 OF 2 READY")).toBeInTheDocument();
  });

  // ADR 0097: the Lobby neither asks for a name nor sends one — the server
  // names the seat from the Account the socket authenticated as, and this
  // Screen only shows what the roster came back with.
  it("shows the roster's name and offers nothing to type", async () => {
    renderLobby({
      lobby: baseLobby({ players: [{ id: "host-id", nickname: "Wobbleton", ready: false, joinOrder: 0, accountId: null, color: null, skin: null, hat: null }] }),
    });

    await waitFor(() => expect(screen.getByText("Wobbleton")).toBeInTheDocument());
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("disables Start until everyone connected is Ready, for the host", () => {
    const onStart = vi.fn();
    const { rerender } = renderLobby({ onStart });

    expect(screen.getByRole("button", { name: /START MATCH/ })).toBeDisabled();

    rerender(
      <MemoryRouter>
        <WithQuery><Lobby
          lobby={baseLobby({
            players: [
              { id: "host-id", nickname: "Host Player", ready: true, joinOrder: 0, accountId: null, color: null, skin: null, hat: null },
              { id: "guest-id", nickname: "Guest", ready: true, joinOrder: 1, accountId: null, color: null, skin: null, hat: null },
            ],
          })}
            onSetReady={noop}
          onSelectTrack={noop}
          onSetRoundType={noop}
          onSetMatchLength={noop}
          onPickRoundSlot={noop}
          onSetBots={noop}
          onStart={onStart}
        /></WithQuery>
      </MemoryRouter>,
    );

    const startButton = screen.getByRole("button", { name: /START MATCH/ });
    expect(startButton).not.toBeDisabled();
    fireEvent.click(startButton);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("swaps the host to the next Track in the API's list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ id: "track-a", name: "Wobble Ramp" }, { id: "track-b", name: null }]), { status: 200 }),
      ),
    );

    const onSelectTrack = vi.fn();
    renderLobby({ onSelectTrack });

    // The loaded Track reads by its authored name once the list arrives.
    expect(await screen.findByText("Wobble Ramp")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Change Track for Round 1"));
    expect(onSelectTrack).toHaveBeenCalledWith("track-b");
  });

  it("still names the loaded Track before the list arrives, rather than the wrong one", () => {
    renderLobby();

    expect(screen.getByText("track-a")).toBeInTheDocument();
    expect(screen.getByLabelText("Change Track for Round 1")).toBeDisabled();
  });

  it("does not fetch the Track list, or offer a picker, for a non-host Player", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock); // overrides the beforeEach default — this test asserts it's never called

    renderLobby({ lobby: baseLobby({ myId: "guest-id" }) });

    expect(screen.getByText("Only the host picks the Track.")).toBeInTheDocument();
    expect(screen.getByText("Waiting for the host to start…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Change Track for Round 1")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  describe("who is talking (ADR 0111)", () => {
    /** Every avatar disc wearing the speaking halo. */
    const speakingDiscs = (container: HTMLElement): Element[] => [...container.querySelectorAll("[class*='speaking']")];

    const twoAccounts = () =>
      baseLobby({
        players: [
          { id: "host-id", nickname: "Host Player", ready: false, joinOrder: 0, accountId: "acc-host", color: null, skin: null, hat: null },
          { id: "guest-id", nickname: "Guest", ready: true, joinOrder: 1, accountId: "acc-guest", color: null, skin: null, hat: null },
        ],
      });

    it("rings the bean whose voice is being heard, and nobody else", () => {
      speakingNow = ["acc-guest"];

      const { container } = renderLobby({ lobby: twoAccounts() });

      expect(speakingDiscs(container)).toHaveLength(1);
    });

    it("rings nobody while the room is quiet", () => {
      const { container } = renderLobby({ lobby: twoAccounts() });

      expect(speakingDiscs(container)).toHaveLength(0);
    });

    it("keeps your own ring as well as the speaking one — both cues, not one replacing the other", () => {
      speakingNow = ["acc-host"];

      const { container } = renderLobby({ lobby: twoAccounts() });

      // `myId` is the host here, so their card already wore the accent ring.
      expect(container.querySelectorAll("[class*='ringed'][class*='speaking']")).toHaveLength(1);
    });

    it("leaves an anonymous seat alone — the relay names speakers by Account", () => {
      // An Account id that is talking, and a seat that never authenticated.
      speakingNow = ["acc-host"];

      const { container } = renderLobby({
        lobby: baseLobby({
          players: [
            { id: "host-id", nickname: "Host Player", ready: false, joinOrder: 0, accountId: null, color: null, skin: null, hat: null },
          ],
        }),
      });

      expect(speakingDiscs(container)).toHaveLength(0);
    });
  });

  describe("the join code (ADR 0054)", () => {
    it("shows the broker's code for a private Lobby", () => {
      renderLobby({ code: "PLUMJA" });

      expect(screen.getByRole("button", { name: "Copy the code PLUMJA" })).toHaveTextContent("PLUMJA");
      expect(screen.getByText("PRIVATE")).toBeInTheDocument();
    });

    it("says so for a quick-matched public Lobby, which has no code to share", () => {
      renderLobby();

      expect(screen.getByText("PUBLIC")).toBeInTheDocument();
      expect(screen.getByText("QUICK MATCH")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "INVITE FRIENDS" })).toBeDisabled();
    });

    it("copies the code for sharing from the code itself, and flashes it (ADR 0110)", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });

      renderLobby({ code: "PLUMJA" });

      fireEvent.click(screen.getByRole("button", { name: "Copy the code PLUMJA" }));
      expect(writeText).toHaveBeenCalledWith("PLUMJA");
      expect(await screen.findByText("Invite code copied.")).toBeInTheDocument();
    });

    it("a copy that fails flashes why instead of claiming it", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("denied"));
      vi.stubGlobal("navigator", { clipboard: { writeText } });

      renderLobby({ code: "PLUMJA" });

      fireEvent.click(screen.getByRole("button", { name: "Copy the code PLUMJA" }));
      expect(await screen.findByText("Couldn't copy the code.")).toBeInTheDocument();
    });
  });

  describe("INVITE FRIENDS (ADR 0110)", () => {
    it("opens Friends in place and sends a real invite to this Lobby, confirmed on the flash stack", async () => {
      localStorage.setItem("df_auth_token", "tok");
      const invites: unknown[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: unknown, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith("/friends/invite")) {
            invites.push(JSON.parse(String(init?.body)));
            return Response.json({ id: "inv-1" });
          }
          if (url.endsWith("/friends")) {
            return Response.json({
              friends: [
                { accountId: "acc-f", displayName: "Floppo", avatarUrl: null, color: 1, friendsSince: 0, presence: { status: "online" } },
              ],
              online: 1,
              total: 1,
              requests: [],
            });
          }
          if (url.endsWith("/friends/recent")) return Response.json({ recent: [] });
          if (url.endsWith("/friends/code")) return Response.json({ code: "ABC123" });
          return Response.json([]);
        }),
      );
      renderLobby({ code: "PLUMJA", inviteRef: { kind: "private", code: "PLUMJA" } });

      fireEvent.click(screen.getByRole("button", { name: "INVITE FRIENDS" }));
      fireEvent.click(await screen.findByRole("button", { name: /^INVITE$/ }));
      expect(await screen.findByText("Invite sent.")).toBeInTheDocument();
      expect(invites).toEqual([{ accountId: "acc-f", lobby: { kind: "private", code: "PLUMJA" } }]);
      localStorage.clear();
    });
  });

  describe("the Round type (M5 ticket 07)", () => {
    it("shows the picked Round type to every Player, host or not", () => {
      renderLobby({ lobby: baseLobby({ myId: "guest-id", roundType: "survival" }) });

      expect(screen.getByText("SURVIVAL")).toBeInTheDocument();
    });

    it("lets the host change it, and nobody else", () => {
      const onSetRoundType = vi.fn();
      const { unmount } = renderLobby({ onSetRoundType });

      fireEvent.click(screen.getByLabelText("Change Round type for Round 1"));
      expect(onSetRoundType).toHaveBeenCalledWith("survival");
      unmount();

      renderLobby({ lobby: baseLobby({ myId: "guest-id" }), onSetRoundType });
      expect(screen.getByText("RACE")).toBeInTheDocument();
      expect(screen.queryByLabelText("Change Round type for Round 1")).not.toBeInTheDocument();
    });

    it("shows the Survivor Target for Survival, and never for a Race", () => {
      const { unmount } = renderLobby({ lobby: baseLobby({ roundType: "survival", survivorTarget: 4 }) });
      expect(screen.getByText(/last 4 Players standing/)).toBeInTheDocument();
      unmount();

      renderLobby({ lobby: baseLobby({ roundType: "race", survivorTarget: 4 }) });
      expect(screen.queryByText(/standing/)).not.toBeInTheDocument();
    });

    it("shows the server's reason a Round can't start, and disables Start with it", () => {
      const readyPlayers = [
        { id: "host-id", nickname: "Host Player", ready: true, joinOrder: 0, accountId: null, color: null, skin: null, hat: null },
        { id: "guest-id", nickname: "Guest", ready: true, joinOrder: 1, accountId: null, color: null, skin: null, hat: null },
      ];
      renderLobby({ lobby: baseLobby({ players: readyPlayers, startBlockedReason: "This Track has no Finish Zone." }) });

      expect(screen.getByText("This Track has no Finish Zone.")).toBeInTheDocument();
      // Everyone is Ready — the only thing holding this Lobby is the Track.
      expect(screen.getByRole("button", { name: /START MATCH/ })).toBeDisabled();
    });

    it("shows the reason to a non-host too, so the wait doesn't look like the host not clicking", () => {
      renderLobby({ lobby: baseLobby({ myId: "guest-id", startBlockedReason: "This Track has no Finish Zone." }) });

      expect(screen.getByText("This Track has no Finish Zone.")).toBeInTheDocument();
    });
  });

  describe("Bots (M17 ticket 10, ADR 0129)", () => {
    it("lets a private Lobby's host pick how many Bots, with none meaning off, and their level once there are some", () => {
      const onSetBots = vi.fn();
      const { unmount } = renderLobby({ code: "PLUMJA", onSetBots });
      expect(screen.queryByRole("button", { name: "HARD" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "More Bots" }));
      expect(onSetBots).toHaveBeenLastCalledWith({ enabled: true, max: 1, level: "normal" });
      unmount();

      renderLobby({ code: "PLUMJA", lobby: baseLobby({ bots: { enabled: true, max: 1, level: "normal" } }), onSetBots });
      fireEvent.click(screen.getByRole("button", { name: "HARD" }));
      expect(onSetBots).toHaveBeenLastCalledWith({ enabled: true, max: 1, level: "hard" });
      fireEvent.click(screen.getByRole("button", { name: "Fewer Bots" }));
      expect(onSetBots).toHaveBeenLastCalledWith({ enabled: false, max: 0, level: "normal" });
    });

    it("lets a public Lobby's host allow Bots, then cap them", () => {
      const onSetBots = vi.fn();
      const { unmount } = renderLobby({ onSetBots });
      expect(screen.queryByText("MAX BOTS")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "ON" }));
      expect(onSetBots).toHaveBeenLastCalledWith({ enabled: true, max: 9, level: "normal" });
      unmount();

      renderLobby({ lobby: baseLobby({ bots: { enabled: true, max: 9, level: "normal" } }), onSetBots });
      fireEvent.click(screen.getByRole("button", { name: "Fewer Bots" }));
      expect(onSetBots).toHaveBeenLastCalledWith({ enabled: true, max: 8, level: "normal" });
      expect(screen.getByRole("button", { name: "More Bots" })).toBeDisabled();
    });

    it("shows a guest the settings as text, with nothing to change them", () => {
      renderLobby({ code: "PLUMJA", lobby: baseLobby({ myId: "guest-id", bots: { enabled: true, max: 3, level: "easy" } }) });
      expect(screen.queryByRole("button", { name: "More Bots" })).toBeNull();
      expect(screen.queryByRole("button", { name: "EASY" })).toBeNull();
      expect(screen.getByText("EASY")).toBeInTheDocument();
    });
  });

  describe("Match length (M7 ticket 05, ADR 0049)", () => {
    it("lets the host raise and lower the Match length within bounds", () => {
      const onSetMatchLength = vi.fn();
      renderLobby({ lobby: baseLobby({ matchLength: 3 }), onSetMatchLength });

      fireEvent.click(screen.getByRole("button", { name: "More Rounds" }));
      expect(onSetMatchLength).toHaveBeenCalledWith(4);
      fireEvent.click(screen.getByRole("button", { name: "Fewer Rounds" }));
      expect(onSetMatchLength).toHaveBeenCalledWith(2);
    });

    it("disables lowering at the minimum and raising at the maximum", () => {
      const { unmount } = renderLobby({ lobby: baseLobby({ matchLength: 1 }) });
      expect(screen.getByRole("button", { name: "Fewer Rounds" })).toBeDisabled();
      unmount();

      renderLobby({ lobby: baseLobby({ matchLength: 10 }) });
      expect(screen.getByRole("button", { name: "More Rounds" })).toBeDisabled();
    });

    it("shows a non-host the Match length as plain text, with no way to change it", () => {
      renderLobby({ lobby: baseLobby({ myId: "guest-id", matchLength: 3 }) });

      expect(screen.getByText("3 Rounds")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "More Rounds" })).not.toBeInTheDocument();
    });
  });

  describe("Upcoming Rounds (M7 ticket 05, ADR 0049)", () => {
    it("shows nothing past Round 1 for a single-Round Match", () => {
      renderLobby({ lobby: baseLobby({ matchLength: 1, roundPicks: [] }) });

      expect(screen.getByLabelText("Change Track for Round 1")).toBeInTheDocument();
      expect(screen.queryByLabelText("Change Track for Round 2")).not.toBeInTheDocument();
    });

    it("lists a row for every Round after the first, labelled by its own number", () => {
      renderLobby({
        lobby: baseLobby({
          matchLength: 3,
          roundPicks: [
            { trackId: null, roundType: null },
            { trackId: null, roundType: null },
          ],
        }),
      });

      expect(screen.getByLabelText("Change Track for Round 2")).toBeInTheDocument();
      expect(screen.getByLabelText("Change Track for Round 3")).toBeInTheDocument();
    });

    it("lets the host change a future slot's Round type, leaving its Track pick untouched", () => {
      const onPickRoundSlot = vi.fn();
      renderLobby({
        lobby: baseLobby({ matchLength: 2, roundPicks: [{ trackId: "track-b", roundType: null }] }),
        onPickRoundSlot,
      });

      fireEvent.click(screen.getByLabelText("Change Round type for Round 2"));

      expect(onPickRoundSlot).toHaveBeenCalledWith(1, "track-b", "race");
    });

    it("wraps a future slot's Round type back to Random — null, the server's own draw", () => {
      const onPickRoundSlot = vi.fn();
      renderLobby({
        lobby: baseLobby({ matchLength: 2, roundPicks: [{ trackId: null, roundType: "survival" }] }),
        onPickRoundSlot,
      });

      fireEvent.click(screen.getByLabelText("Change Round type for Round 2"));

      expect(onPickRoundSlot).toHaveBeenCalledWith(1, null, null);
    });

    it("SHUFFLE ALL puts every future slot back to the server's draw, and never touches Round 1", () => {
      const onPickRoundSlot = vi.fn();
      renderLobby({
        lobby: baseLobby({
          matchLength: 3,
          roundPicks: [
            { trackId: "track-b", roundType: "race" },
            { trackId: "track-c", roundType: "survival" },
          ],
        }),
        onPickRoundSlot,
      });

      fireEvent.click(screen.getByRole("button", { name: "SHUFFLE ALL" }));

      expect(onPickRoundSlot.mock.calls).toEqual([
        [1, null, null],
        [2, null, null],
      ]);
    });

    it("ADD ROUND is one more Round on the Match length the server bounds", () => {
      const onSetMatchLength = vi.fn();
      renderLobby({ lobby: baseLobby({ matchLength: 2, roundPicks: [{ trackId: null, roundType: null }] }), onSetMatchLength });

      fireEvent.click(screen.getByRole("button", { name: "+ ADD ROUND" }));
      expect(onSetMatchLength).toHaveBeenCalledWith(3);
    });

    it("shows a non-host plain text for each future Round, with no controls", () => {
      renderLobby({
        lobby: baseLobby({ myId: "guest-id", matchLength: 2, roundPicks: [{ trackId: "track-b", roundType: "race" }] }),
      });

      expect(screen.getByText("track-b")).toBeInTheDocument();
      expect(screen.queryByLabelText("Change Track for Round 2")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "+ ADD ROUND" })).not.toBeInTheDocument();
    });
  });

  describe("inline Track browser (M9 ticket 16)", () => {
    const ROWS = [
      { id: "track-a", name: "Wobble Ramp", authorId: "a1", createdAt: 1_000, plays: 12, hasFinishZone: true, hasThumbnail: false },
      { id: "track-b", name: "Arena Bowl", authorId: "a1", createdAt: 2_000, plays: 3, hasFinishZone: false, hasThumbnail: false },
    ];

    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(ROWS), { status: 200 })));
    });

    it("BROWSE TRACKS opens the catalogue in place — the Lobby's socket never unmounts", async () => {
      renderLobby();

      fireEvent.click(screen.getByRole("button", { name: "BROWSE TRACKS" }));

      expect(await screen.findByText("DISCOVER")).toBeInTheDocument();
      expect(screen.queryByText("LOBBY")).not.toBeInTheDocument();
      expect(await screen.findByRole("button", { name: /arena bowl/i })).toBeInTheDocument();
      // The loaded Track is badged, so the host sees what they'd be replacing.
      expect(screen.getByText("CURRENT")).toBeInTheDocument();
    });

    it("a card selects straight into Round 1 and closes the browser", async () => {
      const onSelectTrack = vi.fn();
      renderLobby({ onSelectTrack });

      fireEvent.click(screen.getByRole("button", { name: "BROWSE TRACKS" }));
      fireEvent.click(await screen.findByRole("button", { name: /arena bowl/i }));

      expect(onSelectTrack).toHaveBeenCalledWith("track-b");
      expect(screen.getByText("LOBBY")).toBeInTheDocument();
      expect(screen.queryByText("DISCOVER")).not.toBeInTheDocument();
    });

    it("back closes the browser without picking", async () => {
      const onSelectTrack = vi.fn();
      renderLobby({ onSelectTrack });

      fireEvent.click(screen.getByRole("button", { name: "BROWSE TRACKS" }));
      fireEvent.click(await screen.findByRole("button", { name: "Back" }));

      expect(onSelectTrack).not.toHaveBeenCalled();
      expect(screen.getByText("LOBBY")).toBeInTheDocument();
    });

    it("stays disabled for a non-host — only the host picks the Track", () => {
      renderLobby({ lobby: baseLobby({ myId: "guest-id" }) });

      expect(screen.getByRole("button", { name: "BROWSE TRACKS" })).toBeDisabled();
    });
  });
});
