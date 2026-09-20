/**
 * The jitter buffer, as a clock rather than a queue (ADR 0111).
 *
 * Voice arrives over TCP, so nothing is ever lost and nothing ever arrives
 * out of order — only late. There is therefore no loss to conceal, and the
 * only question a buffer has to answer is *when* a frame that just arrived
 * should be heard. That is one number: where the audio already scheduled for
 * this speaker runs out.
 *
 * Holding the frames in a queue and draining them on a timer would answer the
 * same question worse, on a clock (`setTimeout`) that is not the one the
 * audio actually plays on. So this holds no audio at all: a speaker's
 * {@link SpeakerPlayout} says where each arriving frame starts, and the
 * caller schedules it there on its own `AudioContext`.
 *
 * Pure and context-free, so every rule below is tested without Web Audio.
 */
import { VOICE_JITTER_MAX_MS, VOICE_JITTER_TARGET_MS } from "@dont-fall/shared";

/** Where one arriving frame belongs on the playback clock. */
export interface Placement {
  /** When to start it, in the context's own seconds. */
  startAt: number;
  /**
   * Whether everything already scheduled for this speaker must be thrown
   * away first — the buffer was so far ahead that it was behind rather than
   * buffered, and the fresh frame skips past the stale ones (ADR 0111).
   */
  dropScheduled: boolean;
  /**
   * Whether this frame opens a burst: nothing of this speaker's was still
   * scheduled to play. The first frame after they pressed talk, and the
   * first after a stall long enough to drain the buffer.
   */
  opensBurst: boolean;
}

export interface SpeakerPlayoutOptions {
  /** How far ahead of `now` a fresh burst starts (s) — what pays for arrival jitter. */
  targetSeconds?: number;
  /** Past this much scheduled audio (s) the buffer is behind, not buffered. */
  maxSeconds?: number;
}

/**
 * One speaker's playout clock. A speaker each, because each talks and stalls
 * on their own.
 */
export class SpeakerPlayout {
  /** Where this speaker's scheduled audio runs out, on the playback clock. Zero before anything was scheduled. */
  private horizon = 0;
  private readonly targetSeconds: number;
  private readonly maxSeconds: number;

  constructor(options: SpeakerPlayoutOptions = {}) {
    this.targetSeconds = options.targetSeconds ?? VOICE_JITTER_TARGET_MS / 1000;
    this.maxSeconds = options.maxSeconds ?? VOICE_JITTER_MAX_MS / 1000;
  }

  /**
   * Where a frame arriving at `now` and lasting `frameSeconds` goes.
   *
   * Three cases, and they are the whole design:
   *
   * - **Nothing of theirs is still playing** (a fresh burst, or a stall that
   *   drained the buffer): start a target ahead of now, which is the buffer
   *   filling. Anything earlier would play the moment the network hiccuped.
   * - **Too much of theirs is still playing**: a burst caught up after a
   *   stall, and playing it all would put this speaker further and further
   *   behind the conversation. Throw the scheduled audio away and start
   *   fresh, which is the ADR's "drop the oldest frames to catch up".
   * - **Otherwise**: exactly where the last frame ended. Back to back, so a
   *   sentence has no seam in it.
   */
  place(now: number, frameSeconds: number): Placement {
    const scheduled = this.horizon - now;
    const opensBurst = scheduled <= 0;
    const dropScheduled = !opensBurst && scheduled > this.maxSeconds;
    const startAt = opensBurst || dropScheduled ? now + this.targetSeconds : this.horizon;
    this.horizon = startAt + frameSeconds;
    return { startAt, dropScheduled, opensBurst };
  }

  /** How much of this speaker's audio is still to play at `now` (s) — never negative. */
  scheduledSeconds(now: number): number {
    return Math.max(0, this.horizon - now);
  }

  /** Forgets the clock: the next frame opens a burst. The speaker left, or their socket dropped. */
  reset(): void {
    this.horizon = 0;
  }
}
