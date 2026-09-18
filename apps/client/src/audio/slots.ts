/**
 * Every sound the game can play, by slot (M14 ticket 02, ADR 0087): its files
 * under `public/sounds/` (built by `pnpm build:sounds` from
 * `scripts/sound-library.ts`), the bus it plays on, and how the voice budget
 * treats it.
 *
 * Gains, priorities and distances are first values, tuned by ear (the user's)
 * and against a full Lobby (ticket 13).
 */

export type SoundBus = "effects" | "environment" | "music" | "ui";

export interface SlotConfig {
  /** Paths under `public/sounds/`; one is picked at random per play. */
  files: readonly string[];
  bus: SoundBus;
  /** Linear gain the slot plays at before any per-play gain. */
  gain: number;
  /** Who gives way when the one-shot cap is reached: the lower number. */
  priority: number;
  /** Linear distance model (ADR 0087): full volume up to here… */
  refDistance: number;
  /** …silent from here, and never created past it. */
  maxDistance: number;
  /** ± fraction of playback rate picked at random per play, so repeats don't sound mechanical. */
  pitchJitter: number;
  /** A looping slot: at most this many of its emitters sound at once, the nearest ones. */
  maxLoops?: number;
}

const variants = (path: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${path}_${i}.ogg`);

type SlotOptions = Partial<Omit<SlotConfig, "files" | "bus">>;

const effect = (files: readonly string[], options: SlotOptions = {}): SlotConfig => ({
  files,
  bus: "effects",
  gain: 1,
  priority: 3,
  refDistance: 3,
  maxDistance: 35,
  pitchJitter: 0.06,
  ...options,
});

const loop = (bus: SoundBus, file: string, options: SlotOptions = {}): SlotConfig => ({
  files: [file],
  bus,
  gain: 1,
  priority: 2,
  refDistance: 3,
  maxDistance: 25,
  pitchJitter: 0,
  maxLoops: 1,
  ...options,
});

const call = (files: string | readonly string[], options: SlotOptions = {}): SlotConfig => ({
  files: typeof files === "string" ? [files] : files,
  bus: "ui",
  gain: 1,
  priority: 10,
  refDistance: 1,
  maxDistance: 1,
  pitchJitter: 0,
  ...options,
});

export const SOUND_SLOTS = {
  "character.footstep": effect(variants("character/footstep", 5), { gain: 0.45, priority: 1, maxDistance: 22, pitchJitter: 0.1 }),
  "character.land": effect(variants("character/land", 5), { gain: 0.7 }),
  "character.land_heavy": effect(variants("character/land_heavy", 5), { priority: 4 }),
  "character.jump": effect(variants("character/jump", 5), { gain: 0.5, priority: 2, pitchJitter: 0.1 }),
  "character.dash": effect(variants("character/dash", 3), { gain: 0.8 }),
  "character.slide": loop("effects", "character/slide_loop.ogg", { gain: 0.6, priority: 3, maxDistance: 30, maxLoops: 4 }),
  "character.spring": effect(variants("character/spring", 1), { priority: 5, maxDistance: 50 }),
  "character.fall": effect(variants("character/fall", 3), { gain: 0.6, priority: 5 }),
  "character.respawn": effect(variants("character/respawn", 1), { gain: 0.6, priority: 5 }),
  "character.hit_swing": effect(variants("character/hit_swing", 2), { gain: 0.7, priority: 4 }),
  "character.hit_land": effect(variants("character/hit_land", 5), { priority: 6, maxDistance: 45 }),
  "character.hit_land_heavy": effect(variants("character/hit_land_heavy", 5), { priority: 7, maxDistance: 50 }),
  "character.grab": effect(variants("character/grab", 4), { gain: 0.7, priority: 4 }),
  "character.knockdown": effect(variants("character/knockdown", 5), { priority: 7, maxDistance: 45 }),
  "character.knockdown_hard": effect(variants("character/knockdown_hard", 5), { priority: 8, maxDistance: 50 }),
  "character.getup": effect(variants("character/getup", 2), { gain: 0.5, priority: 3 }),
  // No files of their own: a hold's grip is a quiet slap, a Bump a soft body thud (ticket 06).
  "character.grip": effect(variants("character/hit_land", 5), { gain: 0.45, priority: 4, pitchJitter: 0.08 }),
  "character.bump": effect(variants("character/land", 5), { gain: 0.6, priority: 3, pitchJitter: 0.1 }),
  // A hold's, stand-ins too (ADR 0104): no files were sourced for it, and each
  // of these is an existing sound pitched away from what it usually means.
  "character.escape": effect(variants("character/jump", 5), { gain: 0.7, priority: 4, pitchJitter: 0.05 }),
  "character.limp": effect(variants("character/knockdown", 5), { gain: 0.5, priority: 4 }),
  "character.spin": effect(variants("segment/spin_pass", 1), { gain: 0.8, priority: 5, maxDistance: 35 }),
  "character.hurl": effect(variants("character/hit_swing", 2), { priority: 6, maxDistance: 45 }),

  "surface.mud": effect(variants("surface/mud", 4), { gain: 0.5, priority: 1, maxDistance: 22, pitchJitter: 0.1 }),
  "surface.ice": effect(variants("surface/ice", 5), { gain: 0.45, priority: 1, maxDistance: 22, pitchJitter: 0.1 }),
  "surface.bounce": effect(variants("surface/bounce", 1), { priority: 4, pitchJitter: 0.1 }),

  "segment.swing": effect(variants("segment/swing", 5), { priority: 5, refDistance: 4, maxDistance: 40 }),
  "segment.swing_heavy": effect(variants("segment/swing_heavy", 2), { priority: 5, refDistance: 5, maxDistance: 45 }),
  "segment.spin_pass": effect(variants("segment/spin_pass", 1), { priority: 5, refDistance: 3, maxDistance: 20 }),
  "segment.slide_stop": effect(variants("segment/slide_stop", 5), { gain: 0.6, priority: 3, maxDistance: 30 }),
  "segment.fan": loop("effects", "segment/fan_loop.ogg", { maxDistance: 25, maxLoops: 2 }),
  "segment.belt": loop("effects", "segment/belt_loop.ogg", { gain: 0.7, refDistance: 2, maxDistance: 18, maxLoops: 2 }),
  "segment.slide_rumble": loop("effects", "segment/slide_rumble_loop.ogg", { gain: 0.6, maxDistance: 20, maxLoops: 3 }),
  // Stand-ins sharing files (ticket 08): the air through a fan's column is the day wind, nearer and
  // on the effects bus; a Spring settling is the plank knock, quiet and lifted.
  "segment.air_rush": loop("effects", "environment/wind_day_loop.ogg", { gain: 0.5, refDistance: 2, maxDistance: 18, maxLoops: 2 }),
  "segment.spring_settle": effect(variants("segment/slide_stop", 5), { gain: 0.35, priority: 2, maxDistance: 25 }),

  "environment.wind_day": loop("environment", "environment/wind_day_loop.ogg"),
  "environment.wind_night": loop("environment", "environment/wind_night_loop.ogg"),
  "environment.birds": loop("environment", "environment/birds_loop.ogg"),
  "environment.crickets": loop("environment", "environment/crickets_loop.ogg"),

  "match.count_3": call("match/count_3.ogg"),
  "match.count_2": call("match/count_2.ogg"),
  "match.count_1": call("match/count_1.ogg"),
  "match.go": call("match/go.ogg"),
  "match.hurry_up": call("match/hurry_up.ogg"),
  "match.time_over": call("match/time_over.ogg"),
  "match.final_round": call("match/final_round.ogg"),
  "match.you_win": call("match/you_win.ogg"),
  "match.congratulations": call("match/congratulations.ogg"),
  "match.checkpoint": call("match/checkpoint.ogg", { gain: 0.7 }),
  "match.qualified": call("match/qualified.ogg"),
  "match.round_end": call("match/round_end.ogg"),
  "match.results": call("match/results.ogg"),
  "match.results_win": call("match/results_win.ogg"),

  "ui.click": call(variants("ui/click", 5), { gain: 0.6 }),
  "ui.confirm": call(variants("ui/confirm", 4), { gain: 0.7 }),
  "ui.back": call(variants("ui/back", 4), { gain: 0.6 }),
  "ui.toggle": call(variants("ui/toggle", 4), { gain: 0.6 }),
  "ui.tick": call(variants("ui/tick", 3), { gain: 0.5 }),
} satisfies Record<string, SlotConfig>;

export type SoundSlot = keyof typeof SOUND_SLOTS;

/**
 * Another player's Character sounds this much quieter than your own, on top
 * of its distance, so a crowd never drowns out what you do yourself.
 */
export const OTHER_PLAYER_GAIN = 0.7;

export const soundSlot = (slot: SoundSlot): SlotConfig => SOUND_SLOTS[slot];

/**
 * The slots every Stage decodes up front (ADR 0087): what any Character can make. A Track's own
 * sounds join per Track (`stageSoundSlots`).
 */
export const STAGE_SOUND_SLOTS: readonly SoundSlot[] = [
  "character.land",
  "character.land_heavy",
  "character.jump",
  "character.dash",
  "character.slide",
  "character.spring",
  "character.fall",
  "character.respawn",
  "character.hit_swing",
  "character.hit_land",
  "character.hit_land_heavy",
  "character.grab",
  "character.grip",
  "character.bump",
  "character.escape",
  "character.limp",
  "character.spin",
  "character.hurl",
  "character.knockdown",
  "character.knockdown_hard",
  "character.getup",
  "character.footstep",
  "surface.mud",
  "surface.ice",
  "surface.bounce",
  // The Match's voice and jingles (ticket 10).
  "match.count_3",
  "match.count_2",
  "match.count_1",
  "match.go",
  "match.hurry_up",
  "match.time_over",
  "match.final_round",
  "match.you_win",
  "match.congratulations",
  "match.checkpoint",
  "match.qualified",
  "match.round_end",
  "match.results",
  "match.results_win",
];
