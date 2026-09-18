// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HitFeedback from "./HitFeedback";
import s from "./HitFeedback.module.css";

describe("HitFeedback", () => {
  it("is only a light red for a Hit that leaves you standing — no word, no crack (2026-09-18)", () => {
    const { container } = render(<HitFeedback />);

    expect(container.querySelector(`.${s.tint}`)).toBeInTheDocument();
    expect(container.textContent).toBe("");
    expect(container.querySelector(`.${s.cracks}`)).toBeNull();
    expect(container.querySelector(`.${s.snap}`)).toBeNull();
  });

  it("reads KNOCKED DOWN when the same Hit downed you", () => {
    render(<HitFeedback knockedDown />);

    expect(screen.getByRole("status", { name: "KNOCKED DOWN" })).toBeInTheDocument();
    expect(screen.getByText("A HIT PUT YOU ON THE DECK")).toBeInTheDocument();
  });

  it("paints the knockout's crack stroke by stroke from the point of impact: every trunk first, each branch after the trunks start", () => {
    const { container } = render(<HitFeedback knockedDown />);

    const strokes = [...container.querySelectorAll(`.${s.line} path`)] as SVGPathElement[];
    expect(strokes.length).toBeGreaterThan(4); // grown from the design's four
    for (const stroke of strokes) expect(stroke.getAttribute("pathLength")).toBe("1");
    const startOf = (weight: string) =>
      strokes.filter((p) => p.classList.contains(s[weight]!)).map((p) => parseFloat(p.style.getPropertyValue("--df-fx-delay")));
    expect(Math.max(...startOf("trunk"))).toBeLessThan(Math.min(...startOf("branch")));
    expect(Math.max(...startOf("branch"))).toBeLessThan(Math.max(...startOf("hair")));
    // Every trunk leaves the point of impact, where the bloom is.
    for (const trunk of strokes.filter((p) => p.classList.contains(s.trunk!))) expect(trunk.getAttribute("d")).toMatch(/^M980 300/);
  });

  it("renders no Stage chrome — an overlay keeps the live game visible underneath", () => {
    const { container } = render(<HitFeedback knockedDown />);

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
