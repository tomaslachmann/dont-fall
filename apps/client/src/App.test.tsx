// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { type Account } from "./lib/api/auth.js";
import { setStoredToken } from "./lib/api/base.js";
import { App } from "./App";
import { WithQuery } from "./test/query.js";
import { parseLobbyParams, parsePlayParams } from "./lib/utils/routeParams.js";

const { startGame } = vi.hoisted(() => ({ startGame: vi.fn() }));
vi.mock("./game/index.js", () => ({ startGame }));

const ACCOUNT: Account = { id: "a1", discordId: "d1", email: null, displayName: "Wobbleton", avatarUrl: null, xp: 0, coins: 0, bodySkin: 0, hat: null, bindings: null };

// Every existing test below exercises the gated (post-login) routes — a
// stored token that resolves is the default here, same as any real Player
// who's already logged in. `AuthGate` itself gets its own dedicated tests
// further down, with no token/a rejected token.
beforeEach(() => {
  localStorage.clear();
  setStoredToken("tok-1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) =>
      String(url).endsWith("/auth/me")
        ? new Response(JSON.stringify(ACCOUNT), { status: 200 })
        : new Response(JSON.stringify({ maxPlayers: 10, onlinePlayers: 3244 }), { status: 200 }),
    ),
  );
});

describe("App", () => {
  it("opens on the Main Menu, not straight into a running game", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );
    // The wordmark is a logo image in the new design, not body text.
    expect(await screen.findByRole("img", { name: /DON.T FALL/ })).toBeInTheDocument();
    expect(startGame).not.toHaveBeenCalled();
  });

  it("Play opens the broker screen, not a running game — the game boots only inside a Lobby or a Playtest", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    // Regex: the accessible name carries the kicker ("QUICK MATCH · N BEANS ONLINE PLAY").
    fireEvent.click(await screen.findByRole("button", { name: /PLAY/ }));
    expect(screen.queryByRole("img", { name: /DON.T FALL/ })).not.toBeInTheDocument();
    // The broker screen (quick match / private create / join), with no
    // socket and no game behind it.
    expect(await screen.findByText("QUICK MATCH")).toBeInTheDocument();
    expect(startGame).not.toHaveBeenCalled();
  });

  it("passes a `?track=` on /play through to the game — Track Builder's own Playtest link", async () => {
    startGame.mockResolvedValue({ stop: vi.fn() });

    render(
      <MemoryRouter initialEntries={["/play?track=abc123"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));
    expect(startGame.mock.calls[0]![0].trackId).toBe("abc123");
  });

  it("a bare /play is the broker screen — no Track, no game boot", async () => {
    startGame.mockResolvedValue({ stop: vi.fn() });

    render(
      <MemoryRouter initialEntries={["/play"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    expect(await screen.findByText("QUICK MATCH")).toBeInTheDocument();
    expect(startGame).not.toHaveBeenCalled();
  });

  it("/match/:matchId is the fetched results page — no game boot behind it", async () => {
    startGame.mockResolvedValue({ stop: vi.fn() });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).endsWith("/auth/me")) return new Response(JSON.stringify(ACCOUNT), { status: 200 });
        return new Response(
          JSON.stringify({
            matchId: "m1",
            results: [{ rows: [{ id: "a", placement: 1, qualified: true }] }],
            nicknames: { a: "Mushy" },
            totalFalls: { a: 0 },
            endedAtMs: 60_000,
          }),
          { status: 200 },
        );
      }),
    );

    render(
      <MemoryRouter initialEntries={["/match/m1?me=a"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Mushy TAKES THE CROWN")).toBeInTheDocument();
    expect(startGame).not.toHaveBeenCalled();
  });
});

describe("AuthGate (M9 ticket 11, ADR 0052 — mandatory login, app-wide)", () => {
  it("with no stored session, redirects / to /auth instead of rendering the Main Menu", async () => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());

    render(
      <MemoryRouter initialEntries={["/"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "DISCORD" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /PLAY/ })).not.toBeInTheDocument();
    expect(startGame).not.toHaveBeenCalled();
  });

  it("with no stored session, redirects /play?freeroam=1 to /auth too — Practice is not exempt", async () => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());

    render(
      <MemoryRouter initialEntries={["/play?track=abc&freeroam=1"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "DISCORD" })).toBeInTheDocument();
    expect(startGame).not.toHaveBeenCalled();
  });

  it("a stored but rejected (401) session also redirects to /auth", async () => {
    setStoredToken("stale-token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "not logged in" }), { status: 401 })));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "DISCORD" })).toBeInTheDocument();
  });
});

describe("NotFound (the catch-all route)", () => {
  it("an unknown URL renders 404 with the attempted path, authed", async () => {
    render(
      <MemoryRouter initialEntries={["/definitely-not-here"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    expect(await screen.findByText("404 · NOT FOUND")).toBeInTheDocument();
    expect(screen.getByText("/definitely-not-here")).toBeInTheDocument();
  });

  it("an unknown URL renders 404 even with no session — a typo is not a missing login", async () => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());

    render(
      <MemoryRouter initialEntries={["/definitely-not-here"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    expect(await screen.findByText("404 · NOT FOUND")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "DISCORD" })).not.toBeInTheDocument();
  });

  it("MAIN MENU routes back home from 404", async () => {
    render(
      <MemoryRouter initialEntries={["/definitely-not-here"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /MAIN MENU/ }));
    expect(await screen.findByRole("button", { name: /PLAY/ })).toBeInTheDocument();
  });
});

describe("Discover route (M9 ticket 16)", () => {
  const ROWS = [
    { id: "t1", name: "Wobble Ramp", authorId: "a1", createdAt: 1_000, plays: 12, hasFinishZone: true, hasThumbnail: false },
  ];

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).endsWith("/auth/me")) return new Response(JSON.stringify(ACCOUNT), { status: 200 });
        if (String(url).endsWith("/tracks")) return new Response(JSON.stringify(ROWS), { status: 200 });
        return new Response(JSON.stringify({ maxPlayers: 10, onlinePlayers: 3244 }), { status: 200 });
      }),
    );
  });

  it("/discover renders the catalogue off the real listing", async () => {
    render(
      <MemoryRouter initialEntries={["/discover"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: /wobble ramp/i })).toBeInTheDocument();
  });

  it("the Main Menu's DISCOVER pill routes to the catalogue", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "DISCOVER" }));
    expect(await screen.findByRole("button", { name: /wobble ramp/i })).toBeInTheDocument();
  });

  it("BROWSE DISCOVER routes to the catalogue from 404", async () => {
    render(
      <MemoryRouter initialEntries={["/definitely-not-here"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /BROWSE DISCOVER/ }));
    expect(await screen.findByRole("button", { name: /wobble ramp/i })).toBeInTheDocument();
  });
});

describe("Character route (M9 ticket 15 — the stub)", () => {
  it("/character renders the stub screen", async () => {
    render(
      <MemoryRouter initialEntries={["/character"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    expect(await screen.findByText("YOUR BEAN")).toBeInTheDocument();
  });

  it("the Main Menu's CHARACTER pill routes to the stub", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "CHARACTER" }));
    expect(await screen.findByText("YOUR BEAN")).toBeInTheDocument();
  });
});

describe("Profile route", () => {
  it("/profile renders the career card", async () => {
    render(
      <MemoryRouter initialEntries={["/profile"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    expect(await screen.findByText("PROFILE")).toBeInTheDocument();
  });

  it("the Main Menu's account block routes to the profile", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Profile" }));
    expect(await screen.findByText("PROFILE")).toBeInTheDocument();
  });
});

describe("parseLobbyParams (ADR 0054 — the broker names the port)", () => {
  it("reads the Lobby port the broker handed back", () => {
    expect(parseLobbyParams(new URLSearchParams("port=51234"))).toEqual({ port: 51234 });
  });

  it("carries a private Lobby's join code alongside it", () => {
    expect(parseLobbyParams(new URLSearchParams("port=51234&code=PLUMJA"))).toEqual({ port: 51234, code: "PLUMJA" });
  });

  it("has no port at all for a junk or missing one — there is nothing to connect to", () => {
    expect(parseLobbyParams(new URLSearchParams(""))).toEqual({});
    expect(parseLobbyParams(new URLSearchParams("port=not-a-port"))).toEqual({});
    expect(parseLobbyParams(new URLSearchParams("port="))).toEqual({});
  });
});

describe("parsePlayParams (m8.1 ticket 01)", () => {
  it("selects a Match boot by default — no practice flag without ?freeroam=1", () => {
    expect(parsePlayParams(new URLSearchParams("track=abc123"))).toEqual({ trackId: "abc123", practice: false });
    expect(parsePlayParams(new URLSearchParams(""))).toEqual({ practice: false });
  });

  it("selects the practice boot only on ?freeroam=1 — any other value stays a Match", () => {
    expect(parsePlayParams(new URLSearchParams("track=abc123&freeroam=1"))).toEqual({
      trackId: "abc123",
      practice: true,
    });
    expect(parsePlayParams(new URLSearchParams("track=abc123&freeroam=0"))).toEqual({
      trackId: "abc123",
      practice: false,
    });
    expect(parsePlayParams(new URLSearchParams("track=abc123&freeroam=yes"))).toEqual({
      trackId: "abc123",
      practice: false,
    });
  });

  it("boots the game in practice mode on /play?track=X&freeroam=1", async () => {
    startGame.mockResolvedValue({ stop: vi.fn() });

    render(
      <MemoryRouter initialEntries={["/play?track=abc123&freeroam=1"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));
    expect(startGame.mock.calls[0]![0].trackId).toBe("abc123");
    expect(startGame.mock.calls[0]![0].practice).toBe(true);
  });

  it("leaves a plain /play?track=X as a Match boot — no practice flag", async () => {
    startGame.mockResolvedValue({ stop: vi.fn() });

    render(
      <MemoryRouter initialEntries={["/play?track=abc123"]}>
        <WithQuery><App /></WithQuery>
      </MemoryRouter>,
    );

    await waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));
    expect(startGame.mock.calls[0]![0].practice).not.toBe(true);
  });
});
