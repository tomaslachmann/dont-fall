// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NO_AVATAR } from "../lib/avatar.js";
import SpeakingRow, { type SpeakingBean } from "./SpeakingRow.js";

const bean = (accountId: string, nickname: string, you = false): SpeakingBean => ({
  accountId,
  look: NO_AVATAR,
  nickname,
  you,
});

describe("SpeakingRow (ADR 0111)", () => {
  it("draws nothing at all while nobody is talking — no empty furniture mid-Round", () => {
    const { container } = render(<SpeakingRow speaking={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("names a single speaker", () => {
    render(<SpeakingRow speaking={[bean("acc-b", "Splatto")]} />);

    expect(screen.getByText("SPLATTO")).toBeDefined();
  });

  it("says MIC for your own voice, not your own name — it is telling you the microphone is live", () => {
    render(<SpeakingRow speaking={[bean("acc-me", "Bean", true)]} />);

    expect(screen.getByText("MIC")).toBeDefined();
    expect(screen.queryByText("BEAN")).toBeNull();
  });

  it("drops the name once several talk at once, and keeps every bean", () => {
    const { container } = render(
      <SpeakingRow speaking={[bean("acc-a", "Splatto"), bean("acc-b", "Wobble"), bean("acc-c", "Tumble")]} />,
    );

    expect(screen.queryByText("SPLATTO")).toBeNull();
    expect(screen.queryByText("WOBBLE")).toBeNull();
    // One avatar disc per speaker, all wearing the speaking halo.
    expect(container.querySelectorAll("[class*='speaking']")).toHaveLength(3);
  });
});
