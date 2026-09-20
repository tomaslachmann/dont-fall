/**
 * Voice chat's contracts (ADR 0111): the scope a Player picks, the rule that
 * decides who hears whom, and the wire between a client and the relay.
 *
 * Shared owns all three because both sides must agree on them and neither may
 * decide alone: the relay applies the link rule to every frame, and the
 * client only ever renders what the relay already allowed.
 */

/**
 * Whom a Player's Voice chat reaches (CONTEXT.md, ADR 0110/0111). OFF is
 * neither sending nor hearing — never "listen only".
 */
export const VOICE_SCOPES = ["OFF", "PARTY", "ALL"] as const;
export type VoiceScope = (typeof VOICE_SCOPES)[number];

/** The mock's own initial (ADR 0111): your Party hears you, strangers do not, until you say otherwise. */
export const DEFAULT_VOICE_SCOPE: VoiceScope = "PARTY";

/** How a Player sends: only while the `talk` Control is held, or whenever the gate opens. */
export const TALK_MODES = ["PUSH TO TALK", "OPEN MIC"] as const;
export type TalkMode = (typeof TALK_MODES)[number];

export const DEFAULT_TALK_MODE: TalkMode = "PUSH TO TALK";

export const isVoiceScope = (value: unknown): value is VoiceScope => VOICE_SCOPES.includes(value as VoiceScope);
export const isTalkMode = (value: unknown): value is TalkMode => TALK_MODES.includes(value as TalkMode);

/** One member of a voice room, as the link rule reads them. */
export interface VoiceMember {
  accountId: string;
  scope: VoiceScope;
  /** The Party this seat is in (ADR 0112), or `null` for a Player in none. */
  partyId: string | null;
}

/**
 * Whether these two hear each other (ADR 0111) — **both ways, always**:
 * neither is OFF, and either they share a Party or both chose ALL. Nobody
 * hears someone who cannot hear them back, so there is one answer per pair
 * rather than one per direction.
 *
 * A Party of one is not a Party: `partyId` is `null` there, so two Players
 * alone in a Lobby are linked only by both choosing ALL.
 *
 * Mutes are deliberately not here. A Mute is one-way and belongs to the
 * listener alone, so the relay applies it *after* this rule, per recipient.
 */
export const voiceLinked = (a: VoiceMember, b: VoiceMember): boolean => {
  if (a.accountId === b.accountId) return false;
  if (a.scope === "OFF" || b.scope === "OFF") return false;
  if (a.partyId !== null && a.partyId === b.partyId) return true;
  return a.scope === "ALL" && b.scope === "ALL";
};

// --- The wire ---------------------------------------------------------------

/** The relay's path — `ws://host:<voice port>/voice` locally, `wss://host/api/voice` online (ADR 0108). */
export const VOICE_SOCKET_PATH = "/voice";

/**
 * The relay worker's own port, beside the API's 8081 (ADR 0111) — online
 * nginx routes `/api/voice` straight here, so no voice byte crosses the loop
 * every Lobby Ticks on. Overridable with `VOICE_PORT`.
 */
export const DEFAULT_VOICE_PORT = 8083;

/** Close code for an `auth` the relay could not resolve to an Account seated in a Lobby. */
export const VOICE_SOCKET_UNAUTHORIZED = 4001;

/** Close code when the same Account opens a newer voice socket — one per Account, as ADR 0090 does for a seat. */
export const VOICE_SOCKET_REPLACED = 4010;

/**
 * Why a {@link VOICE_SOCKET_UNAUTHORIZED} close happened, in the close
 * reason. Two refusals share the code and could not be less alike, so the
 * client reads which it was rather than guessing:
 *
 * - {@link VOICE_REFUSED_NO_ACCOUNT} is final. A token the API would not take
 *   will not be taken a second later either.
 * - {@link VOICE_REFUSED_NO_ROOM} is a race, and the client redials. A voice
 *   socket can beat its own Lobby's first roster to the relay — the Match
 *   server pushes the roster on the main thread while this socket is already
 *   open on the worker's port — and losing voice for the whole Match over a
 *   few milliseconds would be absurd.
 */
export const VOICE_REFUSED_NO_ACCOUNT = "not signed in";
export const VOICE_REFUSED_NO_ROOM = "not in a lobby";

/**
 * Client → relay, over JSON text frames. Voice itself is binary; these only
 * say who is talking and to whom.
 */
export type VoiceClientMessage =
  /** First message: the Account's session token, and the scope this device is on. */
  | { type: "auth"; token: string; scope: VoiceScope }
  /** The scope changed while the socket stayed open. */
  | { type: "scope"; scope: VoiceScope };

/** One other Player in this room, as the relay names them. */
export interface VoicePeer {
  /**
   * This room's own short name for the peer, which every binary frame carries
   * instead of an Account id — one byte rather than thirty-six, fifty times a
   * second. Stable while the peer stays in the room.
   */
  voiceId: number;
  accountId: string;
  /**
   * Whether the link rule joins this client and that peer — **the rule
   * alone**, deliberately not "would I hear them".
   *
   * A Mute is left out because the pause sheet's Mute rows are drawn from
   * this list (ADR 0111), and a peer whose Mute had already removed them from
   * it would be a peer nobody could ever unmute. The client knows its own
   * Mutes and applies them on top; the relay still enforces them on the wire,
   * so the flag is for drawing rows and never for deciding who is heard.
   */
  linked: boolean;
}

/** Relay → client, over JSON text frames. */
export type VoiceServerMessage =
  /** Signed in, and in this room. */
  | { type: "ready"; accountId: string; voiceId: number }
  /** Who else is here and whether they are heard — sent on every roster, scope or Mute change. */
  | { type: "peers"; peers: VoicePeer[] };

/**
 * A voice frame's header, ahead of the raw Opus payload: a kind byte (so a
 * later frame kind is not mistaken for this one), the speaker's `voiceId`
 * (relay → client only; the relay stamps it, a client never names itself) and
 * a 16-bit sequence the jitter buffer orders and finds gaps by.
 */
export const VOICE_FRAME_KIND_OPUS = 1;

/** Bytes before the payload, client → relay: kind, then the sequence. */
export const VOICE_CLIENT_HEADER_BYTES = 3;

/** Bytes before the payload, relay → client: kind, the speaker, then the sequence. */
export const VOICE_SERVER_HEADER_BYTES = 4;

/** One Opus frame on its way up, sequence and all. */
export const encodeVoiceFrame = (sequence: number, payload: Uint8Array): Uint8Array => {
  const out = new Uint8Array(VOICE_CLIENT_HEADER_BYTES + payload.length);
  out[0] = VOICE_FRAME_KIND_OPUS;
  out[1] = (sequence >>> 8) & 0xff;
  out[2] = sequence & 0xff;
  out.set(payload, VOICE_CLIENT_HEADER_BYTES);
  return out;
};

/** What the relay reads off one — `null` for anything that is not an Opus frame with a payload. */
export const decodeVoiceFrame = (data: Uint8Array): { sequence: number; payload: Uint8Array } | null => {
  if (data.length <= VOICE_CLIENT_HEADER_BYTES || data[0] !== VOICE_FRAME_KIND_OPUS) return null;
  return { sequence: (data[1]! << 8) | data[2]!, payload: data.subarray(VOICE_CLIENT_HEADER_BYTES) };
};

/**
 * The same frame on its way back down, stamped with the speaker. The relay
 * builds it once per speaker-frame and sends the same bytes to every
 * recipient — the recipient's own Mutes decide who gets it, never its content.
 */
export const stampVoiceFrame = (voiceId: number, sequence: number, payload: Uint8Array): Uint8Array => {
  const out = new Uint8Array(VOICE_SERVER_HEADER_BYTES + payload.length);
  out[0] = VOICE_FRAME_KIND_OPUS;
  out[1] = voiceId & 0xff;
  out[2] = (sequence >>> 8) & 0xff;
  out[3] = sequence & 0xff;
  out.set(payload, VOICE_SERVER_HEADER_BYTES);
  return out;
};

/** What a client reads off one — `null` for anything that is not an Opus frame with a payload. */
export const readVoiceFrame = (data: Uint8Array): { voiceId: number; sequence: number; payload: Uint8Array } | null => {
  if (data.length <= VOICE_SERVER_HEADER_BYTES || data[0] !== VOICE_FRAME_KIND_OPUS) return null;
  return {
    voiceId: data[1]!,
    sequence: (data[2]! << 8) | data[3]!,
    payload: data.subarray(VOICE_SERVER_HEADER_BYTES),
  };
};

/** The gap between two 16-bit sequences, wrap included — how many frames a jitter buffer is missing. */
export const voiceSequenceGap = (from: number, to: number): number => ((to - from) & 0xffff);
