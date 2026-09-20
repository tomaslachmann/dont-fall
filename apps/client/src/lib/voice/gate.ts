/**
 * The open-mic gate (ADR 0111): whether the microphone is loud enough to be
 * worth sending, with a hang time so a sentence is not cut between its words.
 *
 * Deliberately not a sensitivity control (the user's choice). The browser's
 * own noise suppression runs first, so this is a "did anyone actually speak"
 * line rather than a noise floor to be dialled in.
 *
 * Pure, and stepped by the caller's own clock, so its two numbers are tested
 * without a microphone.
 */
import { VOICE_GATE_HANG_MS, VOICE_GATE_THRESHOLD } from "@dont-fall/shared";

export interface OpenMicGateOptions {
  threshold?: number;
  hangMs?: number;
}

/** Root mean square of one captured frame, 0–1 — how loud it is, as the gate measures loudness. */
export const frameLevel = (samples: Float32Array): number => {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
};

/** Whether open mic is sending right now, frame by frame. */
export class OpenMicGate {
  private readonly threshold: number;
  private readonly hangMs: number;
  /** When the level was last above the threshold, or `null` while it never has been since the gate closed. */
  private loudAt: number | null = null;

  constructor(options: OpenMicGateOptions = {}) {
    this.threshold = options.threshold ?? VOICE_GATE_THRESHOLD;
    this.hangMs = options.hangMs ?? VOICE_GATE_HANG_MS;
  }

  /**
   * Whether this frame is sent. Open the moment someone speaks, and it stays
   * open for the hang time after they stop — the gap between two words is
   * longer than it sounds, and closing in one would clip every sentence.
   */
  open(level: number, nowMs: number): boolean {
    if (level >= this.threshold) {
      this.loudAt = nowMs;
      return true;
    }
    return this.loudAt !== null && nowMs - this.loudAt < this.hangMs;
  }

  /** Shuts the gate at once — the Player switched to push-to-talk, went OFF, or let go of the microphone. */
  close(): void {
    this.loudAt = null;
  }
}
