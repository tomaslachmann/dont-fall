// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Profile from "./Profile";

const renderProfile = (props: Partial<React.ComponentProps<typeof Profile>> = {}) =>
  render(<Profile name="Wobbleton" level={2} xp={240} xpTarget={2000} color={3} {...props} />);

describe("Profile", () => {
  it("renders the identity card — name, level, XP bar and the signature-pose render", () => {
    renderProfile();

    expect(screen.getByText("Wobbleton")).toBeInTheDocument();
    expect(screen.getByText("LEVEL 2")).toBeInTheDocument();
    expect(screen.getByText("240 / 2 000 XP TO LEVEL 3")).toBeInTheDocument();
    expect(screen.getByText(/SIGNATURE VICTORY POSE/)).toBeInTheDocument();
  });

  it("the XP fill is block-level and proportional — 240 of 2000 fills 12% (an inline span would ignore the width)", () => {
    renderProfile({ xp: 240, xpTarget: 2000 });

    const fill = screen.getByRole("progressbar");
    expect(fill.tagName).toBe("DIV");
    expect(fill).toHaveStyle({ width: "12%" });
    expect(fill).toHaveAttribute("aria-valuenow", "240");
    expect(fill).toHaveAttribute("aria-valuemax", "2000");
  });

  it("the season chip renders only when a season is known — no system, no chip", () => {
    renderProfile();
    expect(screen.queryByText(/SINCE/)).toBeNull();

    renderProfile({ season: "SINCE S1" });
    expect(screen.getAllByText("SINCE S1")).toHaveLength(1);
  });

  it("stats render when provided, loading while the career loads", () => {
    renderProfile({ stats: [{ label: "CROWNS", value: "3", hero: true }] });
    expect(screen.getByText("CROWNS")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("badges show counts and named tiles when provided", () => {
    renderProfile({ badges: { earned: 2, total: 6 }, badgeNames: ["First Steps", "Winner"] });
    expect(screen.getByText("2 OF 6")).toBeInTheDocument();
    expect(screen.getByTitle("First Steps")).toHaveTextContent("1");
    expect(screen.getByTitle("Winner")).toHaveTextContent("2");
  });

  it("recent matches render rows when provided, a zero-state on an empty career", () => {
    renderProfile({
      matches: [{ rank: 1, track: "THE BIG WOBBLE · RACE", points: 520, when: "18 MIN AGO" }],
    });
    expect(screen.getByText("THE BIG WOBBLE · RACE")).toBeInTheDocument();

    renderProfile({ matches: [] });
    expect(screen.getByText("No finished Matches yet — race one and it lands here.")).toBeInTheDocument();
  });

  it("null sections are loading states, failed ones say the career didn't load", () => {
    renderProfile({ stats: null, badges: null, matches: null });
    expect(screen.getAllByText("Loading…")).toHaveLength(3);

    renderProfile({ stats: null, badges: null, matches: null, failed: true });
    expect(screen.getAllByText("Couldn't load the career.")).toHaveLength(3);
  });

  it("the history toggle wears the Route's label", () => {
    renderProfile({ seeAllLabel: "SHOW LESS" });
    expect(screen.getByRole("button", { name: "SHOW LESS" })).toBeInTheDocument();
  });

  it("back, share, edit bean and see-all fire their callbacks — the Route decides what they do", () => {
    const onBack = vi.fn();
    const onShare = vi.fn();
    const onEditBean = vi.fn();
    const onSeeAll = vi.fn();
    renderProfile({ onBack, onShare, onEditBean, onSeeAll });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "SHARE CARD" }));
    fireEvent.click(screen.getByRole("button", { name: "EDIT BEAN" }));
    fireEvent.click(screen.getByRole("button", { name: "SEE ALL" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onEditBean).toHaveBeenCalledTimes(1);
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it("carries no notice line of its own — confirmations and failures are global flashes", () => {
    renderProfile();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
