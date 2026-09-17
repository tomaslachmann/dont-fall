import { DASH_SPEED, isDownMotionState, type RenderCharacter, type Vec3 } from "@dont-fall/shared";
import type { BounceLanding } from "../render/bounceSheets.js";
import type { LoopHandle, PlayOptions, SoundEngine, VoiceHandle } from "./engine.js";
import { FightCues, isHeavyHit, type FightCue } from "./fightCues.js";
import { landingSound } from "./landings.js";
import { MovementCues } from "./movementCues.js";
import { OTHER_PLAYER_GAIN, soundSlot, type SoundSlot } from "./slots.js";

/** The Dash's woosh at the burst's first frame, as a share of full: the nitro build-up starts near zero speed. */
export const DASH_GAIN_FLOOR = 0.4;
/** The woosh's playback rate from the burst's start to full {@link DASH_SPEED}. */
export const DASH_RATE_FROM = 0.85;
export const DASH_RATE_TO = 1.15;

/** Sliding speed (units/s) at which the scrape is at full volume. */
export const SLIDE_LOUD_SPEED = 12;
/** The scrape of a Sliding Character that has barely started to move, as a share of full. */
export const SLIDE_GAIN_FLOOR = 0.25;
/** The scrape's playback rate from standing to {@link SLIDE_LOUD_SPEED}. */
export const SLIDE_RATE_FROM = 0.9;
export const SLIDE_RATE_TO = 1.1;

/**
 * How far your own fighting sounds outrank the same sounds from anyone else
 * under the voice budget (M14 ticket 06): your own knockdown before theirs.
 */
export const OWN_FIGHT_PRIORITY_BOOST = 2;

/** A Hit's swing, from a tap to a full charge: louder, and a little lower. */
export const SWING_GAIN_FROM = 0.5;
export const SWING_RATE_FROM = 1.1;
export const SWING_RATE_TO = 0.9;

/** A grip's pitch: a quick slap, over the punch files it shares. */
export const GRIP_RATE = 1.3;
/** A Bump's thud, lifted a little over the landing files it shares. */
export const BUMP_RATE = 1.15;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/** How loud and how high the Dash's woosh is at `dashSpeed`. */
export const dashLevel = (dashSpeed: number): { gain: number; rate: number } => {
  const share = clamp01(dashSpeed / DASH_SPEED);
  return { gain: lerp(DASH_GAIN_FLOOR, 1, share), rate: lerp(DASH_RATE_FROM, DASH_RATE_TO, share) };
};

/** How loud and how high a Hit's swing is at `charge` (0..1). */
export const swingLevel = (charge: number): { gain: number; rate: number } => {
  const share = clamp01(charge);
  return { gain: lerp(SWING_GAIN_FROM, 1, share), rate: lerp(SWING_RATE_FROM, SWING_RATE_TO, share) };
};

/** How loud and how high the Sliding scrape is at `speed`. */
export const slideLevel = (speed: number): { gain: number; rate: number } => {
  const share = clamp01(speed / SLIDE_LOUD_SPEED);
  return { gain: lerp(SLIDE_GAIN_FLOOR, 1, share), rate: lerp(SLIDE_RATE_FROM, SLIDE_RATE_TO, share) };
};

/** What a Character's sounds ask of the Stage's world. */
export interface CharacterSoundWorld {
  /** Whether a capsule centre stands on a bounce deck. Its takeoffs and landings are the deck's own thump. */
  onBounce: (centre: Vec3) => boolean;
  /** Where the Spring a Character at `centre` just fired sits, if one is near enough to be it. */
  springAt: (centre: Vec3) => Vec3 | undefined;
  /** Below this capsule-centre height a falling Character has nothing left to land on (`fallWhistleY`). */
  fallY: number;
}

/** The part of a drawn Character its sounds are heard from. */
export type SoundCharacter = Pick<
  RenderCharacter,
  | "position"
  | "velocity"
  | "grounded"
  | "motionState"
  | "dashing"
  | "dashSpeed"
  | "launchPadEpoch"
  | "respawnCount"
  | "eliminated"
  | "hitEpoch"
  | "hitChargeMs"
  | "hitReactEpoch"
  | "grabEpoch"
  | "grabbingId"
  | "ragdollEpoch"
  | "ragdollCause"
>;

export type CharacterSoundEngine = Pick<SoundEngine, "play" | "start" | "loop">;

/**
 * The sounds a Character makes, for every Character (ADR 0087), fed once a
 * frame with every drawn Character, your own included.
 *
 * - Getting around (M14 ticket 05): jump, landing, Dash, Sliding, Spring,
 *   Fall, Respawn and a bounce deck's thump.
 * - Fighting (M14 ticket 06): a Hit's swing and landing, Grab's reach and
 *   grip, a knockdown by its cause, getting up, and a Bump.
 *
 * Your own sounds are unpanned, and your own fighting outranks anyone else's
 * under the budget. Anyone else's sounds play where they are,
 * {@link OTHER_PLAYER_GAIN} quieter. The fall whistle is yours alone: another
 * player falling is seen, not heard.
 *
 * An eliminated Character makes no sound, and its loops stop.
 */
export class CharacterSounds {
  private readonly moves: MovementCues;
  private readonly fights = new FightCues();
  private readonly known = new Set<string>();
  private readonly slides = new Map<string, LoopHandle>();
  private readonly dashes = new Map<string, VoiceHandle>();

  constructor(
    private readonly engine: CharacterSoundEngine,
    private readonly world: CharacterSoundWorld,
  ) {
    this.moves = new MovementCues(world.fallY);
  }

  /**
   * `bounceLandings` are this frame's, from the bounce sheets'
   * `BouncePresses`. Only those on a bounce deck thump.
   */
  update(
    characters: Readonly<Record<string, SoundCharacter>>,
    localId: string,
    nowMs: number,
    bounceLandings: readonly BounceLanding[] = [],
  ): void {
    const struck: string[] = [];
    for (const [id, character] of Object.entries(characters)) {
      this.known.add(id);
      if (character.eliminated) {
        this.silence(id);
        continue;
      }
      const local = id === localId;
      const respawned = this.updateMovement(id, character, local, nowMs);
      const fight = this.fights.update(id, { ...character, respawned, nowMs });
      this.playFight(fight, character, local);
      if (fight.struck) struck.push(id);
    }
    // After every swing of the frame is known: a Hit and the swing that threw it arrive together.
    for (const id of struck) {
      const character = characters[id]!;
      const charge = this.fights.chargeOfHitOn(id, character.position, nowMs);
      const slot: SoundSlot = charge !== null && isHeavyHit(charge) ? "character.hit_land_heavy" : "character.hit_land";
      this.playFighting(slot, character, id === localId);
    }
    // Someone who left: a reconnect under the same id starts afresh.
    for (const id of this.known) {
      if (id in characters) continue;
      this.silence(id);
      this.known.delete(id);
    }

    for (const landing of bounceLandings) {
      const character = characters[landing.id];
      if (!character || character.eliminated || !this.world.onBounce(landing.position)) continue;
      const local = landing.id === localId;
      const { gain } = landingSound({ fallSpeed: landing.speed });
      this.engine.play("surface.bounce", {
        ...(local ? {} : { at: landing.position }),
        gain: gain * (local ? 1 : OTHER_PLAYER_GAIN),
      });
    }
  }

  /** Stops every loop and forgets every Character. */
  dispose(): void {
    for (const id of this.known) this.silence(id);
    this.known.clear();
  }

  /** Plays `slot` for a fighting Character, outranking anyone else's when it is your own. */
  private playFighting(slot: SoundSlot, character: SoundCharacter, local: boolean, options: PlayOptions = {}): void {
    const gain = options.gain ?? 1;
    this.engine.play(
      slot,
      local
        ? { ...options, priority: soundSlot(slot).priority + OWN_FIGHT_PRIORITY_BOOST }
        : { ...options, at: character.position, gain: gain * OTHER_PLAYER_GAIN },
    );
  }

  private playFight(cue: FightCue, character: SoundCharacter, local: boolean): void {
    if (cue.swing) {
      const { gain, rate } = swingLevel(cue.swing.charge);
      this.playFighting("character.hit_swing", character, local, { gain, rate });
    }
    if (cue.reached) this.playFighting("character.grab", character, local);
    if (cue.gripped) this.playFighting("character.grip", character, local, { rate: GRIP_RATE });
    if (cue.bumped) this.playFighting("character.bump", character, local, { rate: BUMP_RATE });
    if (cue.knockdown) {
      this.playFighting(cue.knockdown.weight === "heavy" ? "character.knockdown_hard" : "character.knockdown", character, local);
    }
    if (cue.gettingUp) this.playFighting("character.getup", character, local);
  }

  /** Getting around. Returns whether the Character Respawned this frame. */
  private updateMovement(id: string, character: SoundCharacter, local: boolean, nowMs: number): boolean {
    const { position, velocity } = character;
    const cue = this.moves.update(id, { ...character, nowMs });
    const at = local ? undefined : position;
    const placed = (gain: number) => (at ? { at, gain: gain * OTHER_PLAYER_GAIN } : { gain });

    if (cue.takeoff && !this.world.onBounce(cue.takeoff.from)) this.engine.play("character.jump", placed(1));
    if (cue.landing && !this.world.onBounce(position)) {
      const { slot, gain } = landingSound(cue.landing);
      this.engine.play(slot, placed(gain));
    }
    if (cue.launched) {
      this.engine.play("character.spring", local ? {} : { at: this.world.springAt(position) ?? position, gain: OTHER_PLAYER_GAIN });
    }
    if (cue.respawned) this.engine.play("character.respawn", placed(1));
    if (cue.falling && local) this.engine.play("character.fall");

    // The woosh follows the burst's build-up while it lasts, then plays out on
    // its own. It is never cut when `dashing` drops: a replay can drop it for a
    // frame, and a burst that really ended has already faded to its floor.
    const dash = dashLevel(character.dashSpeed);
    if (cue.dashStarted) {
      const voice = this.engine.start("character.dash", { ...placed(dash.gain), rate: dash.rate });
      if (voice) this.dashes.set(id, voice);
      else this.dashes.delete(id);
    } else if (character.dashing) {
      this.dashes.get(id)?.set({ ...placed(dash.gain), rate: dash.rate });
    } else if (isDownMotionState(character.motionState)) {
      // A knockdown owns the body, the woosh included.
      this.dashes.get(id)?.stop();
      this.dashes.delete(id);
    } else {
      this.dashes.delete(id);
    }

    if (character.motionState === "Sliding") {
      const slide = slideLevel(Math.hypot(velocity.x, velocity.y, velocity.z));
      const options = { ...placed(slide.gain), rate: slide.rate };
      const loop = this.slides.get(id);
      if (loop) loop.set(options);
      else this.slides.set(id, this.engine.loop("character.slide", options));
    } else {
      this.slides.get(id)?.stop();
      this.slides.delete(id);
    }
    return cue.respawned;
  }

  private silence(id: string): void {
    this.slides.get(id)?.stop();
    this.slides.delete(id);
    this.dashes.get(id)?.stop();
    this.dashes.delete(id);
    this.moves.forget(id);
    this.fights.forget(id);
  }
}
