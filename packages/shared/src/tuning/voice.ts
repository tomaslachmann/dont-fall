/**
 * Voice chat's numbers (ADR 0111) — the codec, the caps a relay enforces,
 * the open-mic gate, the jitter buffer and how a voice is placed at its
 * Character. Configuration mostly, but the gate and the falloff are feel,
 * and every one of them is the user's to settle live.
 */

/** Opus at 48 kHz mono, the one rate WebCodecs' Opus encoder is specified for. */
export const VOICE_SAMPLE_RATE = 48_000;

/** 20 ms frames — libwebrtc's own default, and the granularity the relay counts in. */
export const VOICE_FRAME_MS = 20;

/** Samples in one frame, at {@link VOICE_SAMPLE_RATE}. */
export const VOICE_FRAME_SAMPLES = (VOICE_SAMPLE_RATE * VOICE_FRAME_MS) / 1000;

/**
 * The encoder's target bitrate. RFC 7587 puts full-band speech's sweet spot
 * at 28–40 kbps; 24 kbps is below it on purpose, because every frame is
 * relayed to up to eleven listeners over TCP and the game's own traffic
 * shares the link.
 */
export const VOICE_BITRATE = 24_000;

/**
 * The largest Opus payload the relay forwards. A 20 ms frame at
 * {@link VOICE_BITRATE} is ~60 bytes; this leaves room for a loud transient
 * and none at all for someone using the socket as a file transfer.
 */
export const VOICE_MAX_FRAME_BYTES = 400;

/**
 * The most frames one sender may have relayed in a second — 50/s is the
 * nominal rate, and this leaves headroom for a burst catching up after a
 * stall without letting a client flood the room.
 */
export const VOICE_MAX_FRAMES_PER_SECOND = 75;

/** How long a voice socket may take to send its `auth` before it is closed unauthorized. */
export const VOICE_AUTH_TIMEOUT_MS = 10_000;

/**
 * How long the relay keeps a room whose Lobby has ended (ADR 0111): voice
 * lasts through the MatchOver podium, which lives past the Lobby socket. The
 * room goes as soon as the last member's socket closes; this is only the cap
 * on one nobody leaves.
 */
export const VOICE_ROOM_KEEPALIVE_MS = 10 * 60_000;

/** How often the relay pings an open voice socket, so a quiet one is not dropped by the proxy in front of it. */
export const VOICE_PING_MS = 30_000;

// --- The open-mic gate ------------------------------------------------------

/**
 * How loud the captured frame must be (RMS, 0–1) for open mic to start
 * sending. Above the browser's own noise suppression, so it is a "did anyone
 * speak" line rather than a noise floor. A first guess for the user to feel.
 */
export const VOICE_GATE_THRESHOLD = 0.02;

/** How long open mic keeps sending after the last frame above the threshold, so a sentence is not cut between words. */
export const VOICE_GATE_HANG_MS = 300;

// --- The jitter buffer ------------------------------------------------------

/**
 * How much audio a speaker's buffer holds back before it starts playing.
 * TCP loses nothing, so this only pays for arrival jitter — one frame plus a
 * little.
 */
export const VOICE_JITTER_TARGET_MS = 60;

/**
 * Past this the buffer is behind rather than buffered: the oldest frames are
 * dropped to catch up, which is what a burst after a stall sounds best as.
 */
export const VOICE_JITTER_MAX_MS = 320;

// --- Placing a voice at its Character ---------------------------------------

/** Inside this, a voice is at full volume — about the range a Bump happens in. */
export const VOICE_REF_DISTANCE = 6;

/** Past this the falloff stops: a voice across the Track is quiet, never lost (ADR 0111). */
export const VOICE_FAR_DISTANCE = 60;

/** What a voice at (or past) {@link VOICE_FAR_DISTANCE} is worth, as a share of its close volume. */
export const VOICE_FAR_GAIN = 0.35;

/** How long the cue holds after the last frame arrived, so Speaking does not flicker between words. */
export const VOICE_SPEAKING_HOLD_MS = 250;
