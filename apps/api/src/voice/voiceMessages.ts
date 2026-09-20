/**
 * What the API's main thread and its voice worker say to each other (ADR
 * 0111), over the `MessagePort` a `worker_thread` comes with. Shared by both
 * sides so neither can drift; no voice byte ever travels here — only who is
 * in which room, whose Party is whose, and who has Muted whom.
 */

/** Main thread → worker. */
export type VoiceHostMessage =
  /** Who is seated in this Lobby now, as its Match server says. */
  | { type: "roster"; roomId: string; accountIds: string[] }
  /** That Lobby's Match server is gone; the room lives on for its members (the podium). */
  | { type: "roomEnded"; roomId: string }
  /** This Account's Party changed (ADR 0112) — what the PARTY scope links by. */
  | { type: "party"; accountId: string; partyId: string | null }
  /** Whom this Account has Muted, as stored on it. */
  | { type: "mutes"; accountId: string; muted: string[] }
  /** The answer to one {@link VoiceWorkerMessage} `auth` — `accountId` `null` for a token the API would not take. */
  | { type: "authResult"; requestId: number; accountId: string | null; partyId: string | null; muted: string[] };

/** Worker → main thread. */
export type VoiceWorkerMessage =
  /** Bound, and taking sockets on this port. */
  | { type: "listening"; port: number }
  /** A fresh socket said this token; only the main thread can resolve it (the database is there). */
  | { type: "auth"; requestId: number; token: string };
