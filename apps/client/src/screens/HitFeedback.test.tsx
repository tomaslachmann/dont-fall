// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HitFeedback from "./HitFeedback";
import s from "./HitFeedback.module.css";

describe("HitFeedback", () => {
  it("reads YOU GOT HIT for a plain landing — no attacker, no numbers, nothing invented", () => {
    render(<HitFeedback />);

    expect(screen.getByRole("status", { name: "YOU GOT HIT" })).toBeInTheDocument();
    expect(screen.getByText("A HIT CONNECTED")).toBeInTheDocument();
  });

  it("reads KNOCKED DOWN when the same Hit downed you", () => {
    render(<HitFeedback knockedDown />);

    expect(screen.getByRole("status", { name: "KNOCKED DOWN" })).toBeInTheDocument();
    expect(screen.getByText("A HIT PUT YOU ON THE DECK")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "YOU GOT HIT" })).not.toBeInTheDocument();
  });

  it("renders no Stage chrome — an overlay keeps the live game visible underneath", () => {
    const { container } = render(<HitFeedback />);

    // The Countdown rule: no background, field, or sheen layers — only the
    // fx overlay and the banner. A filled Stage backdrop would black out the
    // live canvas this flashes over.
    const stage = container.firstElementChild?.firstElementChild as HTMLElement | null;
    expect(stage?.style.background).toBe("");
    expect(stage?.querySelector(`.${s.fx} .${s.bleed}`)).toBeInTheDocument();
    expect(stage?.querySelector(`.${s.fx} .${s.cracks} svg`)).toBeInTheDocument();
    expect(stage?.querySelector(`.${s.banner}`)).toBeInTheDocument();
  });
});
