import type { BombPhase, Vec3 } from "@dont-fall/shared";
import type { SoundEngine, VoiceHandle } from "./engine.js";
import type { SoundSlot } from "./slots.js";

/** How long the fuse recording runs (s) — `segment.bomb_fuse` is the whole five-second timer. */
export const BOMB_FUSE_RECORDING_SECONDS = 5;
/** How much faster the timer runs once the fuse is into its warning (the fast tick). */
export const BOMB_WARN_RATE = 1.5;
/** A blast heard later than this after its Tick is history (a Stage built mid-explosion), not an event. */
const BLAST_HEARD_WITHIN_SECONDS = 0.5;

/**
 * What a Bomb's sound does this frame (ADR 0126), read off the phase it is
 * drawn in — a pure edge detector per bomb, like the Character's cues (M14
 * ticket 05), so it never asks the simulation anything:
 *
 * - `light`: it has just been lit — start the timer;
 * - `warn`: its fuse has just reached the warning — hurry the timer;
 * - `out`: it is no longer burning without having gone off — silence it;
 * - `blast`: it has just gone off — cut the timer, and boom.
 */
export type BombCue = "light" | "warn" | "out" | "blast";

export class BombCues {
  private readonly last = new Map<number, { lit: boolean; fast: boolean; blasted: boolean }>();

  update(propIndex: number, phase: BombPhase): BombCue | null {
    const was = this.last.get(propIndex) ?? { lit: false, fast: false, blasted: false };
    if (phase.kind === "lit") {
      this.last.set(propIndex, { lit: true, fast: phase.fast, blasted: false });
      if (!was.lit) return "light";
      return phase.fast && !was.fast ? "warn" : null;
    }
    // A spent bomb's clip leads its blast: until its Tick it is still burning.
    if (phase.kind === "spent" && phase.blasted && phase.secondsSince < 0) return null;
    const blasted = phase.kind === "spent" && phase.blasted;
    this.last.set(propIndex, { lit: false, fast: false, blasted });
    if (blasted && !was.blasted && phase.kind === "spent" && phase.secondsSince <= BLAST_HEARD_WITHIN_SECONDS) return "blast";
    return was.lit ? "out" : null;
  }
}

/** Every Bomb's sound on a Stage (ADR 0126): its timer, following it, and its blast. Silent without an engine. */
export class BombSounds {
  private readonly cues = new BombCues();
  private readonly fuses = new Map<number, VoiceHandle>();

  constructor(private readonly engine: SoundEngine | null) {}

  /** The bomb at `propIndex`, drawn at `at` in `phase`, burning a fuse `fuseSeconds` long. */
  update(propIndex: number, phase: BombPhase, at: Vec3, fuseSeconds: number): void {
    const cue = this.cues.update(propIndex, phase);
    const rate = BOMB_FUSE_RECORDING_SECONDS / fuseSeconds;
    const fuse = this.fuses.get(propIndex);
    if (cue === "light") {
      fuse?.stop();
      const voice = this.engine?.start(FUSE, { at, rate: phase.kind === "lit" && phase.fast ? rate * BOMB_WARN_RATE : rate });
      if (voice) this.fuses.set(propIndex, voice);
      return;
    }
    if (cue === "out" || cue === "blast") {
      fuse?.stop();
      this.fuses.delete(propIndex);
      if (cue === "blast") this.engine?.play(BLAST, { at });
      return;
    }
    fuse?.set({ at, ...(cue === "warn" ? { rate: rate * BOMB_WARN_RATE } : {}) });
  }

  dispose(): void {
    for (const voice of this.fuses.values()) voice.stop();
    this.fuses.clear();
  }
}

const FUSE: SoundSlot = "segment.bomb_fuse";
const BLAST: SoundSlot = "segment.bomb_blast";
