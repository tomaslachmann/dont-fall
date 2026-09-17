import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parseSoundCredits } from "./credits.js";
import { FakeAudioContext, type FakeGain, type FakeNode } from "./fakeAudio.js";
import {
  MUSIC_CROSSFADE_SECONDS,
  MUSIC_DUCK_GAIN,
  MUSIC_FADE_OUT_SECONDS,
  MUSIC_PLAYLISTS,
  MusicPlayer,
  musicFor,
  nextTrack,
  setMusicPhase,
  startAppMusic,
  type MusicContext,
  type MusicElement,
} from "./music.js";

const soundsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "sounds");

class FakeElement implements MusicElement {
  src = "";
  preload = "";
  playing = false;
  plays = 0;
  refuse = false;
  private ended: (() => void)[] = [];
  play(): Promise<void> {
    this.plays += 1;
    if (this.refuse) return Promise.reject(new Error("NotAllowedError"));
    this.playing = true;
    return Promise.resolve();
  }
  pause(): void {
    this.playing = false;
  }
  addEventListener(_type: "ended", listener: () => void): void {
    this.ended.push(listener);
  }
  end(): void {
    this.playing = false;
    for (const listener of this.ended) listener();
  }
}

const setup = (random: () => number = () => 0) => {
  const context = new FakeAudioContext();
  const elements: FakeElement[] = [];
  const deferred: { run: () => void; ms: number }[] = [];
  const player = new MusicPlayer({
    context: context as unknown as MusicContext,
    createElement: () => {
      const element = new FakeElement();
      elements.push(element);
      return element;
    },
    random,
    defer: (run, ms) => deferred.push({ run, ms }),
  });
  // Chain: volume → duck, then one gain per deck, each fed by its element.
  const [volume, duck, deckA, deckB] = context.gains as [FakeGain, FakeGain, FakeGain, FakeGain];
  const flush = (): void => {
    for (const { run } of deferred.splice(0)) run();
  };
  return { context, player, elements, deferred, flush, volume, duck, decks: [deckA, deckB] };
};

describe("music (M14 ticket 11, ADR 0087)", () => {
  it("ships every playlist track, credited", () => {
    const credited = new Set(parseSoundCredits(readFileSync(join(soundsDir, "CREDITS.md"), "utf8")).map((credit) => credit.file));
    for (const track of [...MUSIC_PLAYLISTS.lobby, ...MUSIC_PLAYLISTS.round]) {
      expect(existsSync(join(soundsDir, track)), track).toBe(true);
      expect(credited.has(track), track).toBe(true);
    }
  });

  it("plays the Lobby's playlist in the Lobby, the Round's from the Countdown, ducked at the Round's end", () => {
    expect(musicFor("LOBBY")).toEqual({ playlist: "lobby", ducked: false });
    expect(musicFor("COUNTDOWN")).toEqual({ playlist: "round", ducked: false });
    expect(musicFor("RUNNING")).toEqual({ playlist: "round", ducked: false });
    expect(musicFor("ROUND_END")).toEqual({ playlist: "round", ducked: true });
    expect(musicFor("RESULTS")).toEqual({ playlist: "round", ducked: true });
  });

  it("shuffles without playing the same track twice in a row", () => {
    const tracks = ["a", "b", "c"];
    for (let i = 0; i < 50; i += 1) expect(nextTrack(tracks, "b", () => i / 50)).not.toBe("b");
    expect(nextTrack(["only"], "only", () => 0.9)).toBe("only");
    expect(new Set(Array.from({ length: 30 }, (_, i) => nextTrack(tracks, undefined, () => i / 30)))).toEqual(new Set(tracks));
  });

  it("streams through two element decks into the duck and volume gains, to the speakers", () => {
    const { context, elements, volume, duck, decks } = setup();
    expect(elements).toHaveLength(2);
    expect(volume.connections).toEqual([context.destination]);
    expect(duck.connections).toEqual([volume]);
    expect(decks.every((deck) => deck.connections[0] === duck)).toBe(true);
    expect(context.elementSources.map(({ element }) => element)).toEqual(elements);
    expect(context.elementSources.map(({ node }) => (node as FakeNode).connections[0])).toEqual(decks);
  });

  it("crossfades the playlists on a phase change, and pauses the old deck once it is quiet", () => {
    const { player, elements, decks, deferred, flush } = setup();
    player.setPhase("LOBBY");
    expect(elements[1]!.src).toMatch(/music\/lobby_\d\.ogg$/);
    expect(elements[1]!.playing).toBe(true);
    expect(decks[1]!.gain.targets.at(-1)).toBe(1);

    player.setPhase("COUNTDOWN");
    expect(elements[0]!.src).toMatch(/music\/round_\d\.ogg$/);
    expect(elements[0]!.playing).toBe(true);
    expect(decks[0]!.gain.targets.at(-1)).toBe(1);
    expect(decks[1]!.gain.targets.at(-1)).toBe(0);
    expect(deferred.at(-1)!.ms).toBe(MUSIC_CROSSFADE_SECONDS * 1000);
    expect(elements[1]!.playing).toBe(true);
    flush();
    expect(elements[1]!.playing).toBe(false);

    // RUNNING keeps the same playlist: nothing restarts.
    player.setPhase("RUNNING");
    expect(elements[0]!.plays).toBe(1);
  });

  it("ducks under the Round's end and the Results, and comes back for the next Round", () => {
    const { player, duck } = setup();
    player.setPhase("RUNNING");
    player.setPhase("ROUND_END");
    expect(duck.gain.targets.at(-1)).toBe(MUSIC_DUCK_GAIN);
    player.setPhase("RESULTS");
    expect(duck.gain.targets.at(-1)).toBe(MUSIC_DUCK_GAIN);
    player.setPhase("COUNTDOWN");
    expect(duck.gain.targets.at(-1)).toBe(1);
  });

  it("plays another track of the playlist when one ends, never the same one", () => {
    const tracks = [0, 0.99];
    const { player, elements } = setup(() => tracks.shift() ?? 0);
    player.setPhase("LOBBY");
    const first = elements[1]!.src;
    elements[1]!.end();
    expect(elements[1]!.src).not.toBe(first);
    expect(elements[1]!.playing).toBe(true);
  });

  it("pauses at zero volume instead of playing silently, and picks up again", () => {
    const { player, elements, volume } = setup();
    player.setPhase("LOBBY");
    player.setVolume(0);
    expect(volume.gain.targets.at(-1)).toBe(0);
    expect(elements.every((element) => !element.playing)).toBe(true);
    player.setPhase("COUNTDOWN");
    expect(elements.every((element) => !element.playing)).toBe(true);
    player.setVolume(0.3);
    expect(elements[0]!.playing).toBe(true);
    expect(volume.gain.targets.at(-1)).toBe(0.3);
  });

  it("retries a refused autoplay on resume", async () => {
    const { player, elements } = setup();
    elements[1]!.refuse = true;
    player.setPhase("LOBBY");
    await Promise.resolve();
    expect(elements[1]!.playing).toBe(false);
    elements[1]!.refuse = false;
    player.resume();
    expect(elements[1]!.playing).toBe(true);
  });

  it("remembers the phase it follows, and forgets it once stopped", () => {
    const { player } = setup();
    expect(player.phase).toBeNull();
    player.setPhase("RUNNING");
    expect(player.phase).toBe("RUNNING");
    player.stop();
    expect(player.phase).toBeNull();
  });

  it("plays the Lobby's playlist outside any Match (user, 2026-09-17)", () => {
    const { player, elements } = setup();
    setMusicPhase("RUNNING", () => player);
    expect(elements[1]!.src).toMatch(/round_/);
    setMusicPhase(null, () => player);
    expect(player.phase).toBe("LOBBY");
    expect(elements[0]!.src).toMatch(/lobby_/);
    expect(() => setMusicPhase(null, () => null)).not.toThrow();
  });

  it("starts the app's music on the first gesture, and only resumes it after", () => {
    const { player, elements } = setup();
    const target = new EventTarget();
    const context = { state: "suspended", resume: vi.fn(() => Promise.resolve()) };
    const uninstall = startAppMusic(target, () => player, () => context);
    expect(elements.every((element) => element.plays === 0)).toBe(true);

    target.dispatchEvent(new Event("pointerdown"));
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(player.phase).toBe("LOBBY");
    expect(elements[1]!.plays).toBe(1);

    context.state = "running";
    target.dispatchEvent(new Event("keydown"));
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(elements[1]!.plays).toBe(2);
    expect(elements[0]!.plays).toBe(0);

    uninstall();
    target.dispatchEvent(new Event("pointerdown"));
    expect(elements[1]!.plays).toBe(2);
  });

  it("leaves a Match's music alone on the first gesture", () => {
    const { player, elements } = setup();
    const target = new EventTarget();
    player.setPhase("RUNNING");
    startAppMusic(target, () => player, () => ({ state: "running", resume: () => Promise.resolve() }));
    target.dispatchEvent(new Event("pointerdown"));
    expect(player.phase).toBe("RUNNING");
    expect(elements[1]!.src).toMatch(/round_/);
  });

  it("stays silent without Web Audio", () => {
    const target = new EventTarget();
    startAppMusic(target, () => null, () => null);
    expect(() => target.dispatchEvent(new Event("pointerdown"))).not.toThrow();
  });

  it("fades out and pauses when leaving the Match, then starts afresh on the next", () => {
    const { player, elements, decks, deferred, flush } = setup();
    player.setPhase("LOBBY");
    player.stop();
    expect(decks[1]!.gain.targets.at(-1)).toBe(0);
    expect(deferred.at(-1)!.ms).toBe(MUSIC_FADE_OUT_SECONDS * 1000);
    // Back into a Lobby before the fade's pause runs: that pause is stale.
    player.setPhase("LOBBY");
    flush();
    expect(elements.some((element) => element.playing)).toBe(true);
  });
});
