// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { MatchWinner, ResultsRow } from "@dont-fall/shared";
import type { StandingsRow } from "../game/index.js";
import { StandingsScreen } from "./StandingsScreen";

const row = (overrides: Partial<ResultsRow> = {}): ResultsRow => ({
  id: "a",
  nickname: "Alice",
  qualified: true,
  placement: 1,
  checkpointIndex: 4,
  fallCount: 0,
  dnf: false,
  ...overrides,
});

const standingsRow = (overrides: Partial<StandingsRow> = {}): StandingsRow => ({
  id: "a",
  nickname: "Alice",
  score: 100,
  placement: 1,
  gone: false,
  confirmed: false,
  ...overrides,
});

describe("StandingsScreen", () => {
  it("shows every Round row's nickname and placement, in the order it was handed", () => {
    render(
      <StandingsScreen
        results={[row({ id: "a", nickname: "Alice", placement: 1 }), row({ id: "b", nickname: "Bob", placement: 2 })]}
        standings={[standingsRow({ id: "a", nickname: "Alice" }), standingsRow({ id: "b", nickname: "Bob", placement: 2, score: 50 })]}
        winners={[]}
        roundsRemaining={true}
        onStandingsReady={() => {}}
        onMainMenu={() => {}}
      />,
    );

    const rows = screen.getAllByText(/Alice|Bob/);
    expect(rows.map((el) => el.textContent)).toEqual(["Alice", "Bob", "Alice", "Bob"]);
  });

  it("shows Track progress instead of a placement for a Character that did not Qualify", () => {
    render(
      <StandingsScreen
        results={[row({ id: "a", qualified: false, placement: null, checkpointIndex: 2, fallCount: 3 })]}
        standings={[standingsRow()]}
        winners={[]}
        roundsRemaining={true}
        onStandingsReady={() => {}}
        onMainMenu={() => {}}
      />,
    );

    expect(screen.getByText("Checkpoint 3")).toBeInTheDocument();
    expect(screen.getByText("3 falls")).toBeInTheDocument();
  });

  it("labels a DNF row distinctly in the Round panel", () => {
    render(
      <StandingsScreen
        results={[row({ id: "a", nickname: "Casey", qualified: false, placement: null, dnf: true, checkpointIndex: null })]}
        standings={[standingsRow({ id: "a", nickname: "Casey" })]}
        winners={[]}
        roundsRemaining={true}
        onStandingsReady={() => {}}
        onMainMenu={() => {}}
      />,
    );

    expect(screen.getByText("Left early")).toBeInTheDocument();
  });

  it("renders every Match Score row with its running total", () => {
    render(
      <StandingsScreen
        results={[]}
        standings={[
          standingsRow({ id: "a", nickname: "Alice", score: 137, placement: 1 }),
          standingsRow({ id: "b", nickname: "Bob", score: 82, placement: 2 }),
        ]}
        winners={[]}
        roundsRemaining={true}
        onStandingsReady={() => {}}
        onMainMenu={() => {}}
      />,
    );

    expect(screen.getByText("137")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
  });

  it("renders two Players on one placement as a tie, not silently ordered", () => {
    render(
      <StandingsScreen
        results={[]}
        standings={[
          standingsRow({ id: "a", nickname: "Alice", score: 100, placement: 1 }),
          standingsRow({ id: "b", nickname: "Bob", score: 100, placement: 1 }),
        ]}
        winners={[]}
        roundsRemaining={true}
        onStandingsReady={() => {}}
        onMainMenu={() => {}}
      />,
    );

    expect(screen.getAllByText("#1")).toHaveLength(2);
  });

  it("marks a Player who dropped mid-Match as gone, with their parked Score still shown", () => {
    render(
      <StandingsScreen
        results={[]}
        standings={[standingsRow({ id: "a", nickname: "Casey", score: 42, placement: 1, gone: true })]}
        winners={[]}
        roundsRemaining={true}
        onStandingsReady={() => {}}
        onMainMenu={() => {}}
      />,
    );

    expect(screen.getByText("Casey")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Left the Match")).toBeInTheDocument();
  });
});

describe("StandingsScreen — between Rounds (M7 ticket 10/12, ADR 0051)", () => {
  it("offers a Ready button, not an auto-advance message, and shows no winner", () => {
    const onStandingsReady = vi.fn();
    render(
      <StandingsScreen
        results={[row()]}
        standings={[standingsRow()]}
        winners={[]}
        roundsRemaining={true}
        onStandingsReady={onStandingsReady}
        onMainMenu={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ready for next Round" }));
    expect(onStandingsReady).toHaveBeenCalledOnce();
    expect(screen.queryByText(/wins the Match/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Main Menu" })).not.toBeInTheDocument();
  });
});

describe("StandingsScreen — Match end (M7 ticket 10/12, ADR 0051)", () => {
  const winner: MatchWinner = { id: "a", score: 137 };

  it("names the winner and lets any Player go to the Main Menu independently", () => {
    const onMainMenu = vi.fn();
    render(
      <StandingsScreen
        results={[row()]}
        standings={[standingsRow({ id: "a", nickname: "Alice", score: 137 })]}
        winners={[winner]}
        roundsRemaining={false}
        onStandingsReady={() => {}}
        onMainMenu={onMainMenu}
      />,
    );

    expect(screen.getByText("Alice wins the Match!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Main Menu" }));
    expect(onMainMenu).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Ready for next Round" })).not.toBeInTheDocument();
  });

  it("names both Players on a genuine tie", () => {
    render(
      <StandingsScreen
        results={[row()]}
        standings={[
          standingsRow({ id: "a", nickname: "Alice", score: 137 }),
          standingsRow({ id: "b", nickname: "Bob", score: 137 }),
        ]}
        winners={[
          { id: "a", score: 137 },
          { id: "b", score: 137 },
        ]}
        roundsRemaining={false}
        onStandingsReady={() => {}}
        onMainMenu={() => {}}
      />,
    );

    expect(screen.getByText("Alice & Bob tie for the win!")).toBeInTheDocument();
  });
});
