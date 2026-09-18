// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Grabbed from "./Grabbed";
import HoldingPanel from "./HoldingPanel";
import s from "./HoldingPanel.module.css";

describe("Grabbed (ADR 0104) — the design's screen, over the live Round", () => {
  it("names who has you, and the prompt carries the two keys to wiggle between, as bound", () => {
    render(<Grabbed by="FLOPPO" phase="struggle" progress={40} wiggleKeys={["A", "D"]} />);

    expect(screen.getByText("FLOPPO HAS YOU")).toBeInTheDocument();
    expect(screen.getByText("GRABBED")).toBeInTheDocument();
    expect(screen.getByText("MASH A D TO BREAK FREE")).toBeInTheDocument();
  });

  it("gives a Limp Player nothing to press, and no meter", () => {
    const { container } = render(<Grabbed by="FLOPPO" phase="limp" progress={0} wiggleKeys={["A", "D"]} />);

    expect(screen.getByText("KNOCKED OUT")).toBeInTheDocument();
    expect(screen.queryByText(/TO BREAK FREE/)).not.toBeInTheDocument();
    expect(container.querySelector('[style*="--df-meter-value"]')).toBeNull();
  });

  it("renders no Stage background — the Round you are being carried through stays visible", () => {
    const { container } = render(<Grabbed by="X" phase="struggle" progress={0} wiggleKeys={["A", "D"]} />);
    const stage = container.firstElementChild?.firstElementChild as HTMLElement | null;
    expect(stage?.style.background).toBe("");
  });
});

describe("HoldingPanel (ADR 0104) — assembled from the design's pieces", () => {
  const panel = (over: Partial<Parameters<typeof HoldingPanel>[0]> = {}) => (
    <HoldingPanel
      holding="SPLATTO"
      phase="struggle"
      escape={30}
      timeLeft="1.4s"
      windup={0}
      overspin={0}
      spinKey="F"
      letGoKey="G"
      {...over}
    />
  );

  it("says whom you have, how close they are to getting free, and what F and G do, on the bound keys", () => {
    const { container } = render(panel());

    expect(screen.getByText("YOU HAVE SPLATTO")).toBeInTheDocument();
    expect(screen.getByText("BREAKING FREE")).toBeInTheDocument();
    expect(screen.getByText("F")).toBeInTheDocument();
    expect(screen.getByText("HOLD SPIN · RELEASE HURL")).toBeInTheDocument();
    expect(screen.getByText("G")).toBeInTheDocument();
    expect(screen.getByText("LET GO")).toBeInTheDocument();
    expect(screen.getByText("1.4s")).toBeInTheDocument();
    expect((container.querySelector(`.${s.fill}`) as HTMLElement).style.width).toBe("30%");
  });

  it("shows the wind-up only while Spinning, and asks for the release once it is full", () => {
    const { container, rerender } = render(panel());
    expect(container.querySelector(`.${s.chargeCard}`)).toBeNull();

    rerender(panel({ windup: 0.5 }));
    expect(container.querySelectorAll(`.${s.pipOn}`)).toHaveLength(3);
    expect(screen.getByText("HOLD F")).toBeInTheDocument();

    rerender(panel({ windup: 1, overspin: 0.4 }));
    expect(screen.getByText("RELEASE F")).toBeInTheDocument();
    expect(screen.getByText("DIZZY 40%")).toBeInTheDocument();
    expect(container.querySelector(`.${s.halo}`)).not.toBeNull();
  });

  it("drops the escape bar once they are Limp — there is nothing left for them to fill", () => {
    const { container } = render(panel({ phase: "limp" }));
    expect(screen.getByText("KNOCKED OUT")).toBeInTheDocument();
    expect(container.querySelector(`.${s.track}`)).toBeNull();
  });
});
