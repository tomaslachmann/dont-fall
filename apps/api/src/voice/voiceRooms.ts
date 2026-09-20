import {
  decodeVoiceFrame,
  stampVoiceFrame,
  voiceLinked,
  VOICE_MAX_FRAMES_PER_SECOND,
  VOICE_MAX_FRAME_BYTES,
  VOICE_ROOM_KEEPALIVE_MS,
  VOICE_SOCKET_REPLACED,
  type VoicePeer,
  type VoiceScope,
  type VoiceServerMessage,
} from "@dont-fall/shared";

/**
 * The voice relay's core (ADR 0111): rooms, who is in them, and who hears
 * whose frames. Socket-free on purpose — a connection is whatever can be sent
 * a message and closed — so every rule here is tested without opening one.
 *
 * It is the enforcement, not a suggestion: a frame reaches exactly the
 * Players the link rule and the recipient's own Mutes allow, decided here and
 * never by the sender. The worker thread around it (`voiceRelay.ts`) does the
 * WebSocket, the main thread (`voice.service.ts`) does the rosters, Parties,
 * Mutes and auth.
 */

/** What a room can do to one connected client — a `WebSocket` in the worker, a recorder in a test. */
export interface VoiceSink {
  sendJson: (message: VoiceServerMessage) => void;
  /** One relayed Opus frame, stamped with its speaker. */
  sendFrame: (frame: Uint8Array) => void;
  close: (code: number, reason: string) => void;
}

/** One live voice socket, as the caller holds it — opaque, and only ever handed back to this class. */
export interface VoiceConnection {
  readonly accountId: string;
  readonly roomId: string;
  readonly voiceId: number;
}

interface Member {
  accountId: string;
  /** This room's short name for them, which every relayed frame carries instead of an Account id. */
  voiceId: number;
  /** Their live voice socket, or `null` for a seat whose Player never opened one. */
  sink: VoiceSink | null;
  scope: VoiceScope;
  /** What `peers` was last sent as, so an unchanged roster costs nothing. */
  sentPeers: string;
  /** The frame-rate window: when it started, and how many frames have been relayed in it. */
  windowStartedAt: number;
  framesInWindow: number;
}

interface Room {
  id: string;
  members: Map<string, Member>;
  /**
   * When this room's Lobby ended (ADR 0111) — voice lasts through the
   * MatchOver podium, so the room outlives the Match with the members it had.
   * `null` while the Lobby is live.
   */
  endedAt: number | null;
}

export class VoiceRooms {
  private readonly rooms = new Map<string, Room>();
  /** Where each Account sits — one room at a time (one seat per Account, ADR 0090). */
  private readonly roomByAccount = new Map<string, string>();
  /** Whom each Account has Muted, as the API last read it. Hearing only, and one-way. */
  private readonly mutes = new Map<string, ReadonlySet<string>>();
  /** Each Account's Party (ADR 0112) — what the PARTY scope links by. */
  private readonly parties = new Map<string, string>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Who is seated in this Lobby, as its Match server says. Accounts that
   * arrived get a seat here (and lose any they held elsewhere); Accounts that
   * left lose theirs, and their socket with it — a Player who left the Lobby
   * is out of its voice room at once, whatever their client believes.
   */
  setRoster(roomId: string, accountIds: readonly string[]): void {
    const room = this.rooms.get(roomId) ?? { id: roomId, members: new Map(), endedAt: null };
    this.rooms.set(roomId, room);
    room.endedAt = null;
    const wanted = new Set(accountIds);
    for (const [accountId, member] of [...room.members]) {
      if (wanted.has(accountId)) continue;
      member.sink?.close(VOICE_SOCKET_REPLACED, "left the lobby");
      room.members.delete(accountId);
      if (this.roomByAccount.get(accountId) === roomId) this.roomByAccount.delete(accountId);
    }
    for (const accountId of wanted) {
      if (room.members.has(accountId)) continue;
      // One seat per Account: arriving here takes them out of wherever they
      // were, so a stale roster elsewhere can never keep them in two rooms.
      const previous = this.roomByAccount.get(accountId);
      if (previous !== undefined && previous !== roomId) this.removeFrom(previous, accountId);
      room.members.set(accountId, this.freshMember(accountId, room));
      this.roomByAccount.set(accountId, roomId);
    }
    this.publish(room);
  }

  /**
   * This Lobby's Match server is gone. The room stays with the members it
   * had — voice runs through the podium (ADR 0111) — and goes as soon as they
   * have all left, or when {@link sweep} finds it past its keepalive.
   */
  endRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.endedAt = this.now();
    if ([...room.members.values()].every((member) => member.sink === null)) this.dissolve(room);
  }

  /** This Account's Party changed — whom they are linked to may have, so everyone in their room hears about it. */
  setParty(accountId: string, partyId: string | null): void {
    if (partyId === null) this.parties.delete(accountId);
    else this.parties.set(accountId, partyId);
    const room = this.roomOf(accountId);
    if (room) this.publish(room);
  }

  /** Whom this Account has Muted, as stored on the Account. Applied per recipient, after the link rule. */
  setMutes(accountId: string, mutedAccountIds: readonly string[]): void {
    this.mutes.set(accountId, new Set(mutedAccountIds));
    const room = this.roomOf(accountId);
    if (room) this.publish(room);
  }

  /**
   * This Account's voice socket is open. `null` when it is seated in no
   * Lobby — there is nothing to join, and the caller closes it unauthorized.
   * A second socket for one Account takes the room and closes the first.
   */
  join(accountId: string, scope: VoiceScope, sink: VoiceSink): VoiceConnection | null {
    const room = this.roomOf(accountId);
    const member = room?.members.get(accountId);
    if (!room || !member) return null;
    const older = member.sink;
    member.sink = sink;
    member.scope = scope;
    member.sentPeers = "";
    if (older) older.close(VOICE_SOCKET_REPLACED, "voice opened on another tab");
    sink.sendJson({ type: "ready", accountId, voiceId: member.voiceId });
    this.publish(room);
    return { accountId, roomId: room.id, voiceId: member.voiceId };
  }

  /** That socket closed. A newer one for the same Account has already taken the seat, so this only clears its own. */
  leave(connection: VoiceConnection, sink: VoiceSink): void {
    const room = this.rooms.get(connection.roomId);
    const member = room?.members.get(connection.accountId);
    if (!room || !member || member.sink !== sink) return;
    member.sink = null;
    member.scope = "OFF";
    if (room.endedAt !== null && [...room.members.values()].every((other) => other.sink === null)) {
      this.dissolve(room);
      return;
    }
    this.publish(room);
  }

  /** The scope this device is on changed while the socket stayed open. */
  setScope(connection: VoiceConnection, scope: VoiceScope): void {
    const room = this.rooms.get(connection.roomId);
    const member = room?.members.get(connection.accountId);
    if (!room || !member || member.scope === scope) return;
    member.scope = scope;
    this.publish(room);
  }

  /**
   * One frame from a speaker, relayed to everyone who may hear it. Dropped
   * — never a reason to close the socket — when it is not a voice frame, when
   * its payload is past {@link VOICE_MAX_FRAME_BYTES}, or when this sender is
   * over {@link VOICE_MAX_FRAMES_PER_SECOND}: a client that floods costs
   * itself its own audio, not the room.
   *
   * Returns how many recipients it reached, which is what the tests read.
   */
  relay(connection: VoiceConnection, data: Uint8Array): number {
    const room = this.rooms.get(connection.roomId);
    const speaker = room?.members.get(connection.accountId);
    if (!room || !speaker) return 0;
    const frame = decodeVoiceFrame(data);
    if (frame === null || frame.payload.length > VOICE_MAX_FRAME_BYTES) return 0;
    const at = this.now();
    if (at - speaker.windowStartedAt >= 1_000) {
      speaker.windowStartedAt = at;
      speaker.framesInWindow = 0;
    }
    if (++speaker.framesInWindow > VOICE_MAX_FRAMES_PER_SECOND) return 0;
    // Built once and sent as-is: what a recipient gets never depends on who
    // they are, only whether they get it at all.
    const stamped = stampVoiceFrame(speaker.voiceId, frame.sequence, frame.payload);
    let reached = 0;
    for (const listener of room.members.values()) {
      if (listener.sink === null || !this.hears(listener, speaker)) continue;
      listener.sink.sendFrame(stamped);
      reached += 1;
    }
    return reached;
  }

  /** Closes rooms whose Lobby ended long enough ago that nobody is coming back to them. */
  sweep(): void {
    const at = this.now();
    for (const room of [...this.rooms.values()]) {
      if (room.endedAt === null || at - room.endedAt < VOICE_ROOM_KEEPALIVE_MS) continue;
      this.dissolve(room);
    }
  }

  /** Closes every socket — the API is going down. */
  close(): void {
    for (const room of [...this.rooms.values()]) this.dissolve(room);
    this.mutes.clear();
    this.parties.clear();
  }

  /** How many rooms are live — what a test asserts a keepalive against. */
  get roomCount(): number {
    return this.rooms.size;
  }

  private freshMember(accountId: string, room: Room): Member {
    return {
      accountId,
      voiceId: nextVoiceId(room),
      sink: null,
      scope: "OFF",
      sentPeers: "",
      windowStartedAt: 0,
      framesInWindow: 0,
    };
  }

  private roomOf(accountId: string): Room | undefined {
    const roomId = this.roomByAccount.get(accountId);
    return roomId === undefined ? undefined : this.rooms.get(roomId);
  }

  /** Whether the link rule joins these two — both ways, and nothing to do with Mutes. */
  private linked(a: Member, b: Member): boolean {
    if (a.accountId === b.accountId) return false;
    return voiceLinked(this.linkMemberOf(a), this.linkMemberOf(b));
  }

  /** Whether `listener` hears `speaker`: the link rule both ways, then the listener's own Mute one way. */
  private hears(listener: Member, speaker: Member): boolean {
    if (!this.linked(listener, speaker)) return false;
    return !(this.mutes.get(listener.accountId)?.has(speaker.accountId) ?? false);
  }

  private linkMemberOf(member: Member): { accountId: string; scope: VoiceScope; partyId: string | null } {
    return { accountId: member.accountId, scope: member.scope, partyId: this.parties.get(member.accountId) ?? null };
  }

  /** Tells every connected member of this room who is in it and whom they would hear — only when that changed. */
  private publish(room: Room): void {
    for (const member of room.members.values()) {
      if (member.sink === null) continue;
      const peers: VoicePeer[] = [];
      for (const other of room.members.values()) {
        if (other.accountId === member.accountId || other.sink === null) continue;
        // The link rule alone: a Mute of this peer is the listener's own, and
        // taking them off the list would leave nothing to unmute them from
        // (ADR 0111). `hears` — the rule *and* the Mute — is what relaying a
        // frame asks, and only that.
        peers.push({ voiceId: other.voiceId, accountId: other.accountId, linked: this.linked(member, other) });
      }
      peers.sort((a, b) => a.voiceId - b.voiceId);
      const json = JSON.stringify(peers);
      if (json === member.sentPeers) continue;
      member.sentPeers = json;
      member.sink.sendJson({ type: "peers", peers });
    }
  }

  private removeFrom(roomId: string, accountId: string): void {
    const room = this.rooms.get(roomId);
    const member = room?.members.get(accountId);
    if (!room || !member) return;
    member.sink?.close(VOICE_SOCKET_REPLACED, "joined another lobby");
    room.members.delete(accountId);
    if (this.roomByAccount.get(accountId) === roomId) this.roomByAccount.delete(accountId);
    this.publish(room);
  }

  private dissolve(room: Room): void {
    for (const [accountId, member] of room.members) {
      member.sink?.close(VOICE_SOCKET_REPLACED, "the match is over");
      if (this.roomByAccount.get(accountId) === room.id) this.roomByAccount.delete(accountId);
    }
    room.members.clear();
    this.rooms.delete(room.id);
  }
}

/** The lowest name free in this room, 1–255 — one byte on every frame, so a room past 255 members is not a thing. */
const nextVoiceId = (room: Room): number => {
  const taken = new Set([...room.members.values()].map((member) => member.voiceId));
  for (let id = 1; id <= 255; id += 1) if (!taken.has(id)) return id;
  return 255;
};
