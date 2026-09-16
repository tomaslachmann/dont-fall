// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Profile from "./Profile";

const renderProfile = (props: Partial<React.ComponentProps<typeof Profile>> = {}) =>
  render(<Profile name="Wobbleton" level={2} xp={240} xpTarget={2000} skin={3} {...props} />);

describe("Profile", () => {
  it("renders the identity card — name, level, XP bar and the signature-pose render", () => {
    renderProfile();

    expect(screen.getByText("Wobbleton")).toBeInTheDocument();
    expect(screen.getByText("LEVEL 2")).toBeInTheDocument();
    expect(screen.getByText("240 / 2 000 XP TO LEVEL 3")).toBeInTheDocument();
    expect(screen.getByText(/SIGNATURE VICTORY POSE/)).toBeInTheDocument();
  });

  it("the season chip renders only when a season is known — no system, no chip", () => {
    renderProfile();
    expect(screen.queryByText(/SINCE/)).toBeNull();

    renderProfile({ season: "SINCE S1" });
    expect(screen.getAllByText("SINCE S1")).toHaveLength(1);
  });

  it("stats render when provided, honestly empty when not", () => {
    renderProfile({ stats: [{ label: "CROWNS", value: "3", hero: true }] });
    expect(screen.getByText("CROWNS")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    renderProfile({ stats: null });
    expect(screen.getByText("Career stats aren't tracked yet.")).toBeInTheDocument();
  });

  it("badges show counts and numbered tiles when provided, honestly empty when not", () => {
    renderProfile({ badges: { earned: 2, total: 60 } });
    expect(screen.getByText("2 OF 60")).toBeInTheDocument();

    renderProfile({ badges: null });
    expect(screen.getByText("Badges aren't here yet.")).toBeInTheDocument();
  });

  it("recent matches render rows when provided, honestly empty when not", () => {
    renderProfile({
      matches: [{ rank: 1, track: "THE BIG WOBBLE · RACE", points: 520, when: "18 MIN AGO" }],
    });
    expect(screen.getByText("THE BIG WOBBLE · RACE")).toBeInTheDocument();

    renderProfile({ matches: null });
    expect(screen.getByText("Match history isn't here yet.")).toBeInTheDocument();
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

  it("the notice renders inline — alert for errors, status for info", () => {
    const { rerender } = renderProfile();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();

    rerender(
      <Profile name="Wobbleton" level={2} xp={240} xpTarget={2000} notice={{ text: "Sharing isn't here yet.", tone: "info" }} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Sharing isn't here yet.");
  });
});
