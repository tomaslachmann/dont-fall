// @vitest-environment jsdom
import type { MatchPhase } from "@dont-fall/shared";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setMusicPhase = vi.fn();
vi.mock("../../audio/music.js", () => ({ setMusicPhase }));

const { useMatchMusic } = await import("./useMatchMusic.js");

function Harness({ phase }: { phase: MatchPhase | null }) {
  useMatchMusic(phase);
  return null;
}

beforeEach(() => vi.clearAllMocks());

describe("useMatchMusic (M14 ticket 11)", () => {
  it("tells the music each new phase, and hands it back to the app's own on unmount", () => {
    const { rerender, unmount } = render(<Harness phase={null} />);
    expect(setMusicPhase).not.toHaveBeenCalled();

    rerender(<Harness phase="LOBBY" />);
    rerender(<Harness phase="LOBBY" />);
    rerender(<Harness phase="COUNTDOWN" />);
    expect(setMusicPhase.mock.calls).toEqual([["LOBBY"], ["COUNTDOWN"]]);

    unmount();
    expect(setMusicPhase).toHaveBeenLastCalledWith(null);
  });
});
