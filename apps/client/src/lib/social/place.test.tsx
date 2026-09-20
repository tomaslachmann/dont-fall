// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter, useNavigate, type NavigateFunction } from "react-router";
import type { MatchPhase } from "@dont-fall/shared";
import { connectFakeAccountSocket } from "../../test/fakeAccountSocket.js";
import { setGameActive } from "../gamePresence.js";
import { sendPlace } from "./accountSocket.js";
import { placeFor, useLobbyPresence, usePlaceReporting } from "./place.js";

afterEach(() => {
  setGameActive(false);
  sendPlace("menu");
});

describe("placeFor (ADR 0112)", () => {
  it("is the menu anywhere outside a Lobby, a game, or a Match's results", () => {
    expect(placeFor("/", null, false)).toEqual({ place: "menu" });
    expect(placeFor("/play", null, false)).toEqual({ place: "menu" });
    expect(placeFor("/friends", null, false)).toEqual({ place: "menu" });
  });

  it("is the Lobby while its phase is LOBBY — and while its socket still connects", () => {
    expect(placeFor("/lobby", { port: 51003, phase: "LOBBY" }, false)).toEqual({ place: "lobby", lobbyPort: 51003 });
    expect(placeFor("/lobby", { port: 51003, phase: null }, false)).toEqual({ place: "lobby", lobbyPort: 51003 });
  });

  it("is the Match from LOADING on, through the podium, its table and Rewards", () => {
    for (const phase of ["LOADING", "COUNTDOWN", "RUNNING", "RESULTS"] as MatchPhase[]) {
      expect(placeFor("/lobby", { port: 51003, phase }, true)).toEqual({ place: "match", lobbyPort: 51003 });
    }
    expect(placeFor("/match/m1", null, false)).toEqual({ place: "match" });
    expect(placeFor("/scoreboard", null, false)).toEqual({ place: "match" });
    expect(placeFor("/rewards", null, false)).toEqual({ place: "match" });
    // A Playtest's game has no Lobby, and is still a game.
    expect(placeFor("/play", null, true)).toEqual({ place: "match" });
  });
});

describe("usePlaceReporting (ADR 0112)", () => {
  /** The shell's reporter, plus a stand-in for the `/lobby` route publishing its Lobby. */
  let navigate: NavigateFunction = () => {};
  const Shell = ({ lobby }: { lobby?: { port: number; phase: MatchPhase | null } }) => {
    usePlaceReporting();
    navigate = useNavigate();
    return lobby ? <InLobby {...lobby} /> : null;
  };
  const InLobby = ({ port, phase }: { port: number; phase: MatchPhase | null }) => {
    useLobbyPresence(port, phase);
    return null;
  };

  it("tells the Account socket where the Player goes, and only when it changes", () => {
    const { socket, stop } = connectFakeAccountSocket();
    const view = render(
      <MemoryRouter initialEntries={["/"]}>
        <Shell />
      </MemoryRouter>,
    );

    act(() => navigate("/lobby?port=51003"));
    view.rerender(
      <MemoryRouter initialEntries={["/"]}>
        <Shell lobby={{ port: 51003, phase: null }} />
      </MemoryRouter>,
    );
    view.rerender(
      <MemoryRouter initialEntries={["/"]}>
        <Shell lobby={{ port: 51003, phase: "LOBBY" }} />
      </MemoryRouter>,
    );
    view.rerender(
      <MemoryRouter initialEntries={["/"]}>
        <Shell lobby={{ port: 51003, phase: "LOADING" }} />
      </MemoryRouter>,
    );
    view.rerender(
      <MemoryRouter initialEntries={["/"]}>
        <Shell lobby={{ port: 51003, phase: "RUNNING" }} />
      </MemoryRouter>,
    );
    // The Match ends: the game hands over to the podium, leaving the Lobby's route.
    act(() => navigate("/match/m1"));
    view.rerender(
      <MemoryRouter initialEntries={["/"]}>
        <Shell />
      </MemoryRouter>,
    );
    act(() => navigate("/rewards"));
    act(() => navigate("/"));
    stop();

    expect(socket.sent.slice(1)).toEqual([
      { type: "place", place: "menu" },
      { type: "place", place: "lobby", lobbyPort: 51003 },
      { type: "place", place: "match", lobbyPort: 51003 },
      { type: "place", place: "match" },
      { type: "place", place: "menu" },
    ]);
  });
});
