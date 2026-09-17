// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BINDINGS } from "@dont-fall/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { PracticeHud } from "./PracticeHud";

const noop = () => {};

describe("PracticeHud (m8.1 ticket 03)", () => {
  it("renders the Track name, the controls hint and a way back", () => {
    render(<PracticeHud trackName="Asset demo" finished={false} bindings={DEFAULT_BINDINGS} onBack={noop} />);

    expect(screen.getByText("Asset demo")).toBeInTheDocument();
    expect(screen.getByText(/WASD move/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("renders the hint from the live bindings, not constants (M9 controls)", () => {
    render(
      <PracticeHud
        trackName="Asset demo"
        finished={false}
        bindings={{ ...DEFAULT_BINDINGS, jump: ["KeyJ"], hit: ["Mouse0"] }}
        onBack={noop}
      />,
    );

    expect(screen.getByText(/J jump · Shift dash · LMB hit/)).toBeInTheDocument();
  });

  it("shows no finish toast before the crossing", () => {
    render(<PracticeHud trackName="Asset demo" finished={false} bindings={DEFAULT_BINDINGS} onBack={noop} />);

    expect(screen.queryByText(/Finished — keep running/)).not.toBeInTheDocument();
  });

  it("shows the finish toast once crossed — and it fades, it never locks", () => {
    const { rerender } = render(<PracticeHud trackName="Asset demo" finished={false} bindings={DEFAULT_BINDINGS} onBack={noop} />);

    rerender(<PracticeHud trackName="Asset demo" finished={true} bindings={DEFAULT_BINDINGS} onBack={noop} />);

    const toast = screen.getByText("Finished — keep running");
    expect(toast).toBeInTheDocument();
    // The fade is CSS (animation to transparent); the element carries the
    // class from the first frame so a re-render never re-pops it.
    expect(toast.className).toMatch(/toast/);
  });

  it("leaves on Back click and on Esc", () => {
    const onBack = vi.fn();
    render(<PracticeHud trackName="Asset demo" finished={false} bindings={DEFAULT_BINDINGS} onBack={onBack} />);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { code: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(2);
  });
});
