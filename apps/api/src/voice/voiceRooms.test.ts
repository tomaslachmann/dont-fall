import { beforeEach, describe, expect, it } from "vitest";
import {
  encodeVoiceFrame,
  readVoiceFrame,
  VOICE_MAX_FRAMES_PER_SECOND,
  VOICE_MAX_FRAME_BYTES,
  VOICE_ROOM_KEEPALIVE_MS,
  type VoicePeer,
  type VoiceScope,
  type VoiceServerMessage,
} from "@dont-fall/shared";
import { VoiceRooms, type VoiceSink } from "./voiceRooms.js";

/** A connected client, recording everything the relay sends it. */
class Recorder implements VoiceSink {
  readonly json: VoiceServerMessage[] = [];
  readonly frames: Uint8Array[] = [];
  closedWith: number | null = null;

  sendJson = (message: VoiceServerMessage): void => void this.json.push(message);
  sendFrame = (frame: Uint8Array): void => void this.frames.push(frame);
  close = (code: number): void => {
    this.closedWith = code;
  };

  /** The most recent `peers`, or `[]` when none has arrived. */
  get peers(): VoicePeer[] {
    for (let i = this.json.length - 1; i >= 0; i -= 1) {
      const message = this.json[i]!;
      if (message.type === "peers") return message.peers;
    }
    return [];
  }

  /**
   * Whom the link rule joins it to, as it was last told. Not "whom it hears":
   * a peer this client Muted stays on the list (ADR 0111) so there is a row
   * left to unmute them from — only their frames stop.
   */
  get linkedTo(): string[] {
    return this.peers.filter((peer) => peer.linked).map((peer) => peer.accountId);
  }
}

const FRAME = encodeVoiceFrame(1, new Uint8Array([1, 2, 3]));

let clock = 1_000;
let rooms: VoiceRooms;

beforeEach(() => {
  clock = 1_000;
  rooms = new VoiceRooms(() => clock);
});

/** Seats `accountId` in `room` and opens its voice socket on `scope`. */
const seat = (room: string, accountId: string, scope: VoiceScope, party?: string): Recorder => {
  const sink = new Recorder();
  const roster = new Set(rostersByRoom.get(room) ?? []);
  roster.add(accountId);
  rostersByRoom.set(room, [...roster]);
  rooms.setRoster(room, [...roster]);
  if (party !== undefined) rooms.setParty(accountId, party);
  const connection = rooms.join(accountId, scope, sink);
  sinks.set(accountId, { sink, connection });
  return sink;
};

const rostersByRoom = new Map<string, string[]>();
const sinks = new Map<string, { sink: Recorder; connection: ReturnType<VoiceRooms["join"]> }>();

beforeEach(() => {
  rostersByRoom.clear();
  sinks.clear();
});

const talk = (accountId: string, frame: Uint8Array = FRAME): number => {
  const held = sinks.get(accountId)!;
  return rooms.relay(held.connection!, frame);
};

describe("a voice room", () => {
  it("admits nobody who is not seated in a Lobby", () => {
    expect(rooms.join("stranger", "ALL", new Recorder())).toBeNull();
  });

  it("relays a frame between two ALL strangers, and to nobody else", () => {
    const one = seat("51000", "a", "ALL");
    const other = seat("51000", "b", "ALL");
    const elsewhere = seat("51001", "c", "ALL");

    expect(talk("a")).toBe(1);
    expect(one.frames).toHaveLength(0);
    expect(elsewhere.frames).toHaveLength(0);
    const relayed = readVoiceFrame(other.frames[0]!);
    expect(relayed?.sequence).toBe(1);
    expect([...(relayed?.payload ?? [])]).toEqual([1, 2, 3]);
  });

  it("stamps each speaker with its own name in the room", () => {
    seat("51000", "a", "ALL");
    const other = seat("51000", "b", "ALL");
    talk("a");
    const speaker = readVoiceFrame(other.frames[0]!)?.voiceId;
    expect(speaker).toBe(other.peers.find((peer) => peer.accountId === "a")?.voiceId);
  });

  it("never relays to a stranger on PARTY, and never from anyone OFF", () => {
    seat("51000", "a", "ALL");
    const partyOnly = seat("51000", "b", "PARTY");
    expect(talk("a")).toBe(0);
    expect(partyOnly.frames).toHaveLength(0);

    seat("51000", "c", "OFF");
    expect(talk("c")).toBe(0);
  });

  it("relays inside a Party whatever else its members picked", () => {
    seat("51000", "a", "PARTY", "party-1");
    const mate = seat("51000", "b", "ALL", "party-1");
    seat("51000", "c", "ALL");
    // One recipient: the Party mate. The stranger on ALL is not linked,
    // because `a` is on PARTY and ALL needs both sides.
    expect(talk("a")).toBe(1);
    expect(mate.frames).toHaveLength(1);
  });

  it("follows a scope changed on a live socket", () => {
    const one = seat("51000", "a", "ALL");
    seat("51000", "b", "PARTY");
    expect(talk("a")).toBe(0);
    rooms.setScope(sinks.get("b")!.connection!, "ALL");
    expect(talk("a")).toBe(1);
    expect(one.linkedTo).toEqual(["b"]);
  });

  it("follows a Party formed after both sockets opened", () => {
    seat("51000", "a", "PARTY");
    const mate = seat("51000", "b", "PARTY");
    expect(talk("a")).toBe(0);
    rooms.setParty("a", "party-1");
    rooms.setParty("b", "party-1");
    expect(talk("a")).toBe(1);
    expect(mate.linkedTo).toEqual(["a"]);
  });

  it("stops sending a Muted Player's frames to whoever Muted them, and only to them", () => {
    seat("51000", "a", "ALL");
    const muter = seat("51000", "b", "ALL");
    const third = seat("51000", "c", "ALL");
    rooms.setMutes("b", ["a"]);

    expect(talk("a")).toBe(1);
    expect(muter.frames).toHaveLength(0);
    expect(third.frames).toHaveLength(1);
    // Still listed, so the pause sheet has a row to unmute them from — the
    // Mute stops the frames, not the acquaintance.
    expect(muter.linkedTo).toEqual(["a", "c"]);
    // One way: the Muted Player still hears the one who Muted them.
    expect(talk("b")).toBe(2);
  });

  it("drops a frame past the size cap, and everything past the rate cap", () => {
    seat("51000", "a", "ALL");
    seat("51000", "b", "ALL");
    expect(talk("a", encodeVoiceFrame(1, new Uint8Array(VOICE_MAX_FRAME_BYTES + 1)))).toBe(0);
    expect(talk("a", new Uint8Array([0, 0, 0, 0]))).toBe(0);

    let relayed = 0;
    for (let i = 0; i < VOICE_MAX_FRAMES_PER_SECOND + 20; i += 1) relayed += talk("a");
    expect(relayed).toBe(VOICE_MAX_FRAMES_PER_SECOND);
    // The next second is the sender's again.
    clock += 1_000;
    expect(talk("a")).toBe(1);
  });

  it("takes a Player out of the room the moment the Lobby's roster drops them", () => {
    const one = seat("51000", "a", "ALL");
    const gone = seat("51000", "b", "ALL");
    rooms.setRoster("51000", ["a"]);
    expect(gone.closedWith).not.toBeNull();
    expect(one.linkedTo).toEqual([]);
    expect(talk("a")).toBe(0);
  });

  it("moves a Player who turns up in another Lobby's roster, rather than seating them twice", () => {
    const first = seat("51000", "a", "ALL");
    seat("51000", "b", "ALL");
    rooms.setRoster("51001", ["a"]);
    expect(first.closedWith).not.toBeNull();
    expect(rooms.join("a", "ALL", new Recorder())).not.toBeNull();
    // …and no longer heard in the Lobby they left.
    expect(sinks.get("b")!.sink.linkedTo).toEqual([]);
  });

  it("closes the older socket when one Account opens a second", () => {
    const first = seat("51000", "a", "ALL");
    const second = new Recorder();
    expect(rooms.join("a", "ALL", second)).not.toBeNull();
    expect(first.closedWith).not.toBeNull();
    expect(second.json[0]).toMatchObject({ type: "ready", accountId: "a" });
  });

  it("does not tell a client its peers again when nothing about them moved", () => {
    const one = seat("51000", "a", "ALL");
    seat("51000", "b", "ALL");
    const before = one.json.filter((message) => message.type === "peers").length;
    rooms.setMutes("b", ["c"]); // nobody `a` can see
    expect(one.json.filter((message) => message.type === "peers")).toHaveLength(before);
  });

  it("keeps the room after its Lobby ends, so voice runs through the podium", () => {
    const one = seat("51000", "a", "ALL");
    const other = seat("51000", "b", "ALL");
    rooms.endRoom("51000");
    expect(one.closedWith).toBeNull();
    expect(talk("a")).toBe(1);
    expect(other.frames).toHaveLength(1);
  });

  it("lets a dropped socket back into an ended room — the podium redials", () => {
    seat("51000", "a", "ALL");
    const other = seat("51000", "b", "ALL");
    rooms.endRoom("51000");
    rooms.leave(sinks.get("a")!.connection!, sinks.get("a")!.sink);
    const again = new Recorder();
    expect(rooms.join("a", "ALL", again)).not.toBeNull();
    expect(other.linkedTo).toEqual(["a"]);
  });

  it("closes an ended room once its last member has left", () => {
    seat("51000", "a", "ALL");
    rooms.endRoom("51000");
    expect(rooms.roomCount).toBe(1);
    rooms.leave(sinks.get("a")!.connection!, sinks.get("a")!.sink);
    expect(rooms.roomCount).toBe(0);
  });

  it("closes an ended room nobody left, once its keepalive has run out", () => {
    const one = seat("51000", "a", "ALL");
    rooms.endRoom("51000");
    clock += VOICE_ROOM_KEEPALIVE_MS - 1;
    rooms.sweep();
    expect(rooms.roomCount).toBe(1);
    clock += 2;
    rooms.sweep();
    expect(rooms.roomCount).toBe(0);
    expect(one.closedWith).not.toBeNull();
  });
});
