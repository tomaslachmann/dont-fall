// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import JellyButton from "../ui/JellyButton";
import ReadySwitch from "../ui/ReadySwitch";
import Slider from "../ui/Slider";
import Stepper from "../ui/Stepper";
import Switch from "../ui/Switch";
import Toggle from "../ui/Toggle";
import { createUiSoundPlayer, installUiSounds, TICK_MIN_INTERVAL_MS, UI_SOUND_SLOTS, uiSoundOf } from "./uiSounds.js";
import { SOUND_SLOTS } from "./slots.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.innerHTML = "";
});

const listen = () => {
  const play = vi.fn();
  let clock = 0;
  cleanups.push(installUiSounds(document, play, () => clock));
  return { play, advance: (ms: number) => (clock += ms) };
};

describe("Screens click (M14 ticket 12, ADR 0087)", () => {
  it("names only ui-bus slots", () => {
    for (const slot of Object.values(UI_SOUND_SLOTS)) expect(SOUND_SLOTS[slot].bus).toBe("ui");
  });

  it("clicks a plain button, and plays what a control names", () => {
    const { play } = listen();
    const { getByText } = render(
      <div>
        <button type="button">plain</button>
        <JellyButton sound="confirm">START</JellyButton>
        <JellyButton sound="back">BACK</JellyButton>
        <JellyButton sound="none">QUIET</JellyButton>
        <button type="button" data-ui-sound="back">
          <span>inner</span>
        </button>
      </div>,
    );
    fireEvent.click(getByText("plain"));
    fireEvent.click(getByText("START"));
    fireEvent.click(getByText("BACK"));
    fireEvent.click(getByText("QUIET"));
    fireEvent.click(getByText("inner"));
    expect(play.mock.calls).toEqual([["click"], ["confirm"], ["back"], ["back"]]);
  });

  it("is silent for a disabled button and for anything that isn't a control", () => {
    const { play } = listen();
    const { getByText } = render(
      <div>
        <JellyButton disabled>OFF</JellyButton>
        <p>text</p>
      </div>,
    );
    fireEvent.click(getByText("OFF"));
    fireEvent.click(getByText("text"));
    expect(play).not.toHaveBeenCalled();
    expect(uiSoundOf(null)).toBeNull();
  });

  it("toggles switches and toggles, confirms turning Ready on, and ticks steppers", () => {
    const { play } = listen();
    const { getByRole, getAllByRole, getByLabelText } = render(
      <div>
        <Switch label="shake" />
        <Toggle options={["A", "B"]} value="A" />
        <ReadySwitch ready={false} />
        <Stepper value={3} label="Rounds" />
      </div>,
    );
    fireEvent.click(getByLabelText("shake"));
    fireEvent.click(getByRole("button", { name: "B" }));
    fireEvent.click(getAllByRole("switch")[1]!);
    fireEvent.click(getByLabelText("More Rounds"));
    expect(play.mock.calls).toEqual([["toggle"], ["toggle"], ["confirm"], ["tick"]]);
  });

  it("ticks a dragged slider, at most once per interval, and not for its click", () => {
    const { play, advance } = listen();
    const { container } = render(<Slider label="MASTER" value={50} onChange={() => {}} />);
    const input = container.querySelector("input")!;
    fireEvent.input(input, { target: { value: "51" } });
    advance(TICK_MIN_INTERVAL_MS / 2);
    fireEvent.input(input, { target: { value: "52" } });
    advance(TICK_MIN_INTERVAL_MS);
    fireEvent.input(input, { target: { value: "53" } });
    fireEvent.click(input);
    expect(play.mock.calls).toEqual([["tick"], ["tick"]]);
  });

  it("stops listening when uninstalled", () => {
    const play = vi.fn();
    installUiSounds(document, play)();
    const { getByText } = render(<button type="button">plain</button>);
    fireEvent.click(getByText("plain"));
    expect(play).not.toHaveBeenCalled();
  });

  it("makes no context before the first press, and stays silent without Web Audio", () => {
    const contextOf = vi.fn(() => null);
    const play = createUiSoundPlayer(contextOf);
    expect(contextOf).not.toHaveBeenCalled();
    expect(() => play("click")).not.toThrow();
    expect(contextOf).toHaveBeenCalledTimes(1);
  });

  it("resumes a suspended context on the press itself, and plays once it runs", async () => {
    const played: string[] = [];
    const context = {
      state: "suspended",
      currentTime: 0,
      destination: {},
      resume: vi.fn(() => {
        context.state = "running";
        return Promise.resolve();
      }),
      decodeAudioData: vi.fn(() => Promise.resolve({ duration: 0.1 })),
      createGain: () => ({ gain: { value: 1, setTargetAtTime: () => {} }, connect: () => {}, disconnect: () => {} }),
      createPanner: () => ({}),
      createBufferSource: () => {
        const source = {
          buffer: null as unknown,
          playbackRate: { value: 1 },
          onended: null,
          connect: () => {},
          disconnect: () => {},
          start: () => played.push("start"),
          stop: () => {},
        };
        return source;
      },
    };
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)) })));
    try {
      const play = createUiSoundPlayer(() => context as unknown as AudioContext);
      play("click");
      expect(context.resume).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(played).toEqual(["start"]));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
