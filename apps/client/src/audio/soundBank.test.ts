import { describe, expect, it, vi } from "vitest";
import { fakeBuffer } from "./fakeAudio.js";
import { SOUND_SLOTS } from "./slots.js";
import { decodedBytes, loadSoundBank, SOUNDS_BASE_URL } from "./soundBank.js";

const decodingContext = () => ({ decodeAudioData: vi.fn(async () => fakeBuffer()) });

describe("loadSoundBank (M14 ticket 02)", () => {
  it("fetches and decodes every variant of the slots asked for", async () => {
    const context = decodingContext();
    const fetchFile = vi.fn(async () => new ArrayBuffer(8));
    const bank = await loadSoundBank(context, ["character.land"], fetchFile);
    expect(bank.buffers("character.land")).toHaveLength(SOUND_SLOTS["character.land"].files.length);
    expect(fetchFile).toHaveBeenCalledWith(`${SOUNDS_BASE_URL}character/land_0.ogg`);
    expect(bank.buffers("character.footstep")).toEqual([]);
  });

  it("decodes a file once per context, however many banks ask", async () => {
    const context = decodingContext();
    const fetchFile = vi.fn(async () => new ArrayBuffer(8));
    await loadSoundBank(context, ["character.land"], fetchFile);
    await loadSoundBank(context, ["character.land"], fetchFile);
    expect(fetchFile).toHaveBeenCalledTimes(SOUND_SLOTS["character.land"].files.length);
  });

  it("counts the decoded PCM its context holds, once per file (M14 ticket 13)", async () => {
    const context = { decodeAudioData: vi.fn(async () => fakeBuffer(1, 2, 1000)) };
    const fetchFile = vi.fn(async () => new ArrayBuffer(8));
    expect(decodedBytes(context)).toBe(0);
    await loadSoundBank(context, ["character.land"], fetchFile);
    await loadSoundBank(context, ["character.land", "character.jump"], fetchFile);
    const files = SOUND_SLOTS["character.land"].files.length + SOUND_SLOTS["character.jump"].files.length;
    expect(decodedBytes(context)).toBe(files * 1000 * 2 * 4);
  });

  it("leaves a file that fails out, warns, and never rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = decodingContext();
    const fetchFile = vi.fn(async (url: string) => {
      if (url.endsWith("land_0.ogg")) throw new Error("404");
      return new ArrayBuffer(8);
    });
    const bank = await loadSoundBank(context, ["character.land"], fetchFile);
    expect(bank.buffers("character.land")).toHaveLength(SOUND_SLOTS["character.land"].files.length - 1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
