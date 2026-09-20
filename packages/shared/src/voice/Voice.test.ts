import { describe, expect, it } from "vitest";
import {
  decodeVoiceFrame,
  encodeVoiceFrame,
  readVoiceFrame,
  stampVoiceFrame,
  voiceLinked,
  voiceSequenceGap,
  VOICE_FRAME_KIND_OPUS,
  type VoiceMember,
  type VoiceScope,
} from "./Voice.js";

const member = (accountId: string, scope: VoiceScope, partyId: string | null = null): VoiceMember => ({
  accountId,
  scope,
  partyId,
});

describe("voiceLinked", () => {
  it("links two strangers only when both chose ALL", () => {
    expect(voiceLinked(member("a", "ALL"), member("b", "ALL"))).toBe(true);
    expect(voiceLinked(member("a", "ALL"), member("b", "PARTY"))).toBe(false);
    expect(voiceLinked(member("a", "PARTY"), member("b", "PARTY"))).toBe(false);
  });

  it("links a Party whatever else they picked, as long as neither is OFF", () => {
    expect(voiceLinked(member("a", "PARTY", "p1"), member("b", "PARTY", "p1"))).toBe(true);
    expect(voiceLinked(member("a", "ALL", "p1"), member("b", "PARTY", "p1"))).toBe(true);
    expect(voiceLinked(member("a", "OFF", "p1"), member("b", "PARTY", "p1"))).toBe(false);
  });

  it("does not link different Parties", () => {
    expect(voiceLinked(member("a", "PARTY", "p1"), member("b", "PARTY", "p2"))).toBe(false);
  });

  it("treats no Party as no Party, never as a shared one", () => {
    expect(voiceLinked(member("a", "PARTY", null), member("b", "PARTY", null))).toBe(false);
  });

  it("is symmetric, and never links anyone to themselves", () => {
    const pairs: [VoiceMember, VoiceMember][] = [
      [member("a", "ALL"), member("b", "PARTY")],
      [member("a", "OFF", "p1"), member("b", "ALL", "p1")],
      [member("a", "PARTY", "p1"), member("b", "ALL", "p1")],
      [member("a", "ALL"), member("b", "ALL")],
    ];
    for (const [one, other] of pairs) expect(voiceLinked(one, other)).toBe(voiceLinked(other, one));
    expect(voiceLinked(member("a", "ALL"), member("a", "ALL"))).toBe(false);
  });

  it("never links anyone who is OFF", () => {
    for (const scope of ["OFF", "PARTY", "ALL"] as const) {
      expect(voiceLinked(member("a", "OFF"), member("b", scope))).toBe(false);
    }
  });
});

describe("the voice frame", () => {
  const payload = new Uint8Array([9, 8, 7, 6]);

  it("round-trips a client frame", () => {
    const decoded = decodeVoiceFrame(encodeVoiceFrame(513, payload));
    expect(decoded?.sequence).toBe(513);
    expect([...(decoded?.payload ?? [])]).toEqual([9, 8, 7, 6]);
  });

  it("round-trips a relayed frame, stamped with its speaker", () => {
    const read = readVoiceFrame(stampVoiceFrame(7, 65535, payload));
    expect(read).toEqual({ voiceId: 7, sequence: 65535, payload: expect.anything() });
    expect([...(read?.payload ?? [])]).toEqual([9, 8, 7, 6]);
  });

  it("reads nothing from an empty, short or unknown frame", () => {
    expect(decodeVoiceFrame(new Uint8Array([VOICE_FRAME_KIND_OPUS, 0, 0]))).toBeNull();
    expect(decodeVoiceFrame(new Uint8Array([99, 0, 0, 1]))).toBeNull();
    expect(readVoiceFrame(new Uint8Array([VOICE_FRAME_KIND_OPUS, 1, 0, 0]))).toBeNull();
    expect(readVoiceFrame(new Uint8Array())).toBeNull();
  });

  it("counts a sequence gap through the wrap", () => {
    expect(voiceSequenceGap(10, 11)).toBe(1);
    expect(voiceSequenceGap(65535, 0)).toBe(1);
    expect(voiceSequenceGap(65530, 3)).toBe(9);
  });
});
