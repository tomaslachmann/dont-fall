// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ResultsRow } from "@dont-fall/shared";
import { ResultsScreen } from "./ResultsScreen";

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

describe("ResultsScreen", () => {
  it("shows every row's nickname and placement, in the order it was handed", () => {
    render(
      <ResultsScreen
        results={[
          row({ id: "a", nickname: "Alice", placement: 1 }),
          row({ id: "b", nickname: "Bob", placement: 2 }),
        ]}
        isHost={true}
        onReturnToLobby={() => {}}
      />,
    );

    const rows = screen.getAllByText(/Alice|Bob/);
    expect(rows.map((el) => el.textContent)).toEqual(["Alice", "Bob"]);
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
  });

  it("shows Track progress instead of a placement for a Character that did not Qualify", () => {
    render(
      <ResultsScreen
        results={[row({ id: "a", qualified: false, placement: null, checkpointIndex: 2, fallCount: 3 })]}
        isHost={true}
        onReturnToLobby={() => {}}
      />,
    );

    expect(screen.queryByText("#1")).not.toBeInTheDocument();
    expect(screen.getByText("Checkpoint 3")).toBeInTheDocument();
    expect(screen.getByText("3 falls")).toBeInTheDocument();
  });

  it("labels a DNF row distinctly, with no Checkpoint progress to show", () => {
    render(
      <ResultsScreen
        results={[row({ id: "a", nickname: "Casey", qualified: false, placement: null, dnf: true, checkpointIndex: null })]}
        isHost={true}
        onReturnToLobby={() => {}}
      />,
    );

    expect(screen.getByText("Left early")).toBeInTheDocument();
    expect(screen.getByText("Casey")).toBeInTheDocument();
  });

  it("shows singular 'fall' for exactly one", () => {
    render(<ResultsScreen results={[row({ fallCount: 1 })]} isHost={true} onReturnToLobby={() => {}} />);

    expect(screen.getByText("1 fall")).toBeInTheDocument();
  });

  it("lets the host return to the Lobby", () => {
    const onReturnToLobby = vi.fn();
    render(<ResultsScreen results={[row()]} isHost={true} onReturnToLobby={onReturnToLobby} />);

    fireEvent.click(screen.getByRole("button", { name: "Back to Lobby" }));
    expect(onReturnToLobby).toHaveBeenCalledOnce();
  });

  it("does not offer the Back to Lobby action to a non-host, and says so", () => {
    render(<ResultsScreen results={[row()]} isHost={false} onReturnToLobby={() => {}} />);

    expect(screen.queryByRole("button", { name: "Back to Lobby" })).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for the host to return to the Lobby…")).toBeInTheDocument();
  });
});
