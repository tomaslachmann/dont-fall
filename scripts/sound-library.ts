/**
 * The game's sound library as data (M14 ticket 01, ADR 0087): every runtime
 * file under `apps/client/public/sounds/`, the raw download it is cut from,
 * how it is cut, and where it came from. `build-sounds.ts` turns this table
 * into the files and `CREDITS.md`, so the library can always be rebuilt from
 * `assets/audio/` and no file ships without its origin.
 *
 * Choices here are first picks made without listening. Swapping a sound is
 * editing one row and running `pnpm build:sounds`.
 */

export type Licence = "CC0" | "CC-BY 3.0" | "CC-BY 4.0" | "Generated";

export interface Origin {
  title: string;
  author: string;
  licence: Licence;
  url?: string;
}

interface JobBase {
  /** Output path under `apps/client/public/sounds/`. */
  out: string;
  /** Source path under `assets/audio/`. */
  src: string;
  origin: Origin;
}

export type Job =
  /** Kenney's Ogg Vorbis, shipped as it is. */
  | (JobBase & { kind: "copy" })
  /** A cut one-shot: trimmed of silence, short fades, peak-normalised, Ogg Opus. */
  | (JobBase & { kind: "oneshot"; start?: number; end?: number; stereo?: boolean })
  /**
   * A seamless loop `seconds` long, cut from `start`: its tail crossfades into
   * its head over `crossfade`, then one static gain brings it to `lufs`.
   */
  | (JobBase & {
      kind: "loop";
      start?: number;
      seconds: number;
      crossfade: number;
      lufs: number;
      stereo?: boolean;
      /** ffmpeg audio filters applied before the cut (a stand-in's pitch or tone). */
      filter?: string;
    })
  /** A music track: one static gain to `MUSIC_LUFS`, Ogg Opus stereo. */
  | (JobBase & { kind: "music" });

export const MUSIC_LUFS = -16;

const kenney = (pack: string, title: string): Origin => ({
  title,
  author: "Kenney (www.kenney.nl)",
  licence: "CC0",
  url: `https://kenney.nl/assets/${pack}`,
});
const freesound = (id: number, title: string, author: string, licence: Licence = "CC0"): Origin => ({
  title,
  author,
  licence,
  url: `https://freesound.org/s/${id}/`,
});
const generated = (tool: string, title: string): Origin => ({
  title,
  author: `the game's author, generated with ${tool}`,
  licence: "Generated",
});

const IMPACT = kenney("impact-sounds", "Impact Sounds");
const INTERFACE = kenney("interface-sounds", "Interface Sounds");
const RPG = kenney("rpg-audio", "RPG Audio");
const DIGITAL = kenney("digital-audio", "Digital Audio");
const JINGLES = kenney("music-jingles", "Music Jingles");
const VOICE = kenney("voiceover-pack", "Voiceover Pack (male voice: Jeffrey M. Smith)");

const range = (count: number): number[] => Array.from({ length: count }, (_, i) => i);
const pad3 = (n: number): string => String(n).padStart(3, "0");

const copies = (group: string, slot: string, origin: Origin, sources: string[]): Job[] =>
  sources.map((src, i) => ({ kind: "copy", out: `${group}/${slot}_${i}.ogg`, src, origin }));

const kenneyImpact = (name: string): string[] => range(5).map((i) => `kenney/impact-sounds/Audio/${name}_${pad3(i)}.ogg`);

const WOOSH_PACK = "freesound/woosh-woosh";
const woosh = (id: number, name: string): Pick<JobBase, "src" | "origin"> => ({
  src: `${WOOSH_PACK}/${id}__moogy73__${name}.wav`,
  origin: freesound(id, name, "moogy73"),
});

/** Five jumps in one take, CC0; the user's pick for the jump (2026-09-17). */
const JUMP = {
  src: "freesound/jump-sound.wav",
  origin: {
    title: "JUMP SFX RANDOMISATION - HUMAN MADE",
    author: "CCOUNTERFEIT",
    licence: "CC0",
    url: "https://freesound.org/people/CCOUNTERFEIT/sounds/851416/",
  } satisfies Origin,
};
const MUD = { src: "freesound/mud-Water_Squelch.mp3", origin: freesound(560953, "Water Squelch", "Bricklover") };
const ICE = { src: "freesound/ice-creacking.wav", origin: freesound(342546, "Ice cracking", "timbreknight") };
const TRAMPOLINE = { src: "freesound/Bounce_sheet_thump-trampoline.wav", origin: freesound(540276, "trampoline bounce.wav", "zepurple") };
const BOING = { src: "freesound/Spring_boing-cartoon.mp3", origin: freesound(731262, "cartoon-sound-single-boing", "sdroliasnick") };
const SAND = { src: "freesound/Sliding_scrape_loop-friction.wav", origin: freesound(576088, "S_L_1_Friction_Sand_01.wav", "Tim_Verberne") };
const WIND = { src: "freesound/wind-wind_01.wav", origin: freesound(397091, "Soft Tonal Wind_01", "janbezouska") };
const CRICKETS = { src: "freesound/crickets-night.wav", origin: freesound(522298, "Crickets At Night - Clean sound", "Defelozedd94") };
const BIRDS = { src: "freesound/birds-morning_birds.wav", origin: freesound(342462, "Morning Birds", "nick121087") };
const FAN = { src: "freesound/fan_hum-wind.wav", origin: freesound(17645, "Wind.wav", "Cyril Laurier", "CC-BY 4.0") };
const BELT = { src: "freesound/Conveyor_belt-xray.aiff", origin: freesound(49972, "XRayBelt.aif", "mwl500", "CC-BY 3.0") };
/** A vintage synth notification, CC0; the user's pick for the checkpoint (2026-09-17). */
const CHECKPOINT = {
  src: "freesound/checkpoint-sound.wav",
  origin: {
    title: "Vintage Alert Notification 2_2",
    author: "Joao_Janz",
    licence: "CC0",
    url: "https://freesound.org/people/Joao_Janz/sounds/504861/",
  } satisfies Origin,
};

export const SOUND_LIBRARY: readonly Job[] = [
  // --- character -----------------------------------------------------------
  ...copies("character", "footstep", IMPACT, kenneyImpact("footstep_concrete")),
  ...copies("character", "land", IMPACT, kenneyImpact("impactSoft_medium")),
  ...copies("character", "land_heavy", IMPACT, kenneyImpact("impactSoft_heavy")),
  // The take's five jumps, cut at the gaps `silencedetect` (−35 dB) finds.
  { kind: "oneshot", out: "character/jump_0.ogg", ...JUMP, end: 0.2 },
  { kind: "oneshot", out: "character/jump_1.ogg", ...JUMP, start: 0.28, end: 0.47 },
  { kind: "oneshot", out: "character/jump_2.ogg", ...JUMP, start: 0.54, end: 0.76 },
  { kind: "oneshot", out: "character/jump_3.ogg", ...JUMP, start: 0.86, end: 1.08 },
  { kind: "oneshot", out: "character/jump_4.ogg", ...JUMP, start: 1.14 },
  { kind: "oneshot", out: "character/dash_0.ogg", ...woosh(425703, "woosh_medium_01") },
  { kind: "oneshot", out: "character/dash_1.ogg", ...woosh(425705, "woosh_medium_03") },
  { kind: "oneshot", out: "character/dash_2.ogg", ...woosh(425706, "woosh_medium_short_01") },
  { kind: "loop", out: "character/slide_loop.ogg", ...SAND, seconds: 6, crossfade: 1, lufs: -20 },
  { kind: "oneshot", out: "character/spring_0.ogg", ...BOING },
  ...copies("character", "fall", DIGITAL, range(3).map((i) => `kenney/digital-audio/Audio/phaserDown${i + 1}.ogg`)),
  ...copies("character", "respawn", DIGITAL, ["kenney/digital-audio/Audio/powerUp2.ogg"]),
  { kind: "oneshot", out: "character/hit_swing_0.ogg", ...woosh(425696, "woosh_high_01") },
  { kind: "oneshot", out: "character/hit_swing_1.ogg", ...woosh(425695, "woosh_high_02") },
  ...copies("character", "hit_land", IMPACT, kenneyImpact("impactPunch_medium")),
  ...copies("character", "hit_land_heavy", IMPACT, kenneyImpact("impactPunch_heavy")),
  ...copies("character", "grab", RPG, range(4).map((i) => `kenney/rpg-audio/Audio/cloth${i + 1}.ogg`)),
  ...copies("character", "knockdown", IMPACT, kenneyImpact("impactSoft_heavy")),
  ...copies("character", "knockdown_hard", IMPACT, kenneyImpact("impactWood_heavy")),
  ...copies("character", "getup", RPG, ["kenney/rpg-audio/Audio/clothBelt.ogg", "kenney/rpg-audio/Audio/clothBelt2.ogg"]),

  // --- surface: what the feet land on -----------------------------------------
  // Cut at the gaps `silencedetect` (−35 dB) finds in each recording.
  { kind: "oneshot", out: "surface/mud_0.ogg", ...MUD, start: 0.3, end: 0.56 },
  { kind: "oneshot", out: "surface/mud_1.ogg", ...MUD, start: 1.03, end: 1.21 },
  { kind: "oneshot", out: "surface/mud_2.ogg", ...MUD, start: 2.68, end: 3.07 },
  { kind: "oneshot", out: "surface/mud_3.ogg", ...MUD, start: 3.22, end: 3.59 },
  { kind: "oneshot", out: "surface/ice_0.ogg", ...ICE, start: 0.43, end: 0.68 },
  { kind: "oneshot", out: "surface/ice_1.ogg", ...ICE, start: 1.23, end: 1.47 },
  { kind: "oneshot", out: "surface/ice_2.ogg", ...ICE, start: 1.52, end: 1.73 },
  { kind: "oneshot", out: "surface/ice_3.ogg", ...ICE, start: 2.27, end: 2.65 },
  { kind: "oneshot", out: "surface/ice_4.ogg", ...ICE, start: 3.92, end: 4.29 },
  { kind: "oneshot", out: "surface/bounce_0.ogg", ...TRAMPOLINE, end: 0.6 },

  // --- segment: moving obstacles and machines ------------------------------------
  { kind: "oneshot", out: "segment/swing_0.ogg", ...woosh(425693, "woosh_low_01") },
  { kind: "oneshot", out: "segment/swing_1.ogg", ...woosh(425700, "woosh_low_02") },
  { kind: "oneshot", out: "segment/swing_2.ogg", ...woosh(425699, "woosh_low_03") },
  { kind: "oneshot", out: "segment/swing_3.ogg", ...woosh(425698, "woosh_low_04") },
  { kind: "oneshot", out: "segment/swing_4.ogg", ...woosh(425697, "woosh_low_05") },
  { kind: "oneshot", out: "segment/swing_heavy_0.ogg", ...woosh(425702, "woosh_low_long01") },
  { kind: "oneshot", out: "segment/swing_heavy_1.ogg", ...woosh(425701, "woosh_low_long02") },
  // Spinners: a woosh as a bar passes the listener (user, 2026-09-17), no loop. woosh_low_04 is the
  // user's pick for it (2026-09-17), the same take one of the swings uses.
  { kind: "oneshot", out: "segment/spin_pass_0.ogg", ...woosh(425698, "woosh_low_04") },
  ...copies("segment", "slide_stop", IMPACT, kenneyImpact("impactPlank_medium")),
  { kind: "loop", out: "segment/fan_loop.ogg", ...FAN, start: 4, seconds: 12, crossfade: 2, lufs: -22 },
  { kind: "loop", out: "segment/belt_loop.ogg", ...BELT, start: 1, seconds: 6, crossfade: 1, lufs: -22 },
  // Stand-in (ADR 0087 amendment): the fan hum, an octave-ish lower and duller.
  {
    kind: "loop",
    out: "segment/slide_rumble_loop.ogg",
    ...FAN,
    start: 4,
    seconds: 12,
    crossfade: 2,
    lufs: -24,
    filter: "asetrate=44100*0.6,aresample=48000,lowpass=f=450",
  },
  // A Bomb's fuse (ADR 0126): five seconds of timer, played through once per
  // lighting at whatever rate makes it last the fuse — the user's pick.
  {
    kind: "oneshot",
    out: "segment/bomb_fuse.ogg",
    src: "freesound/487725__lilmati__ticking-timer-05-sec.wav",
    origin: freesound(487725, "Ticking Timer 05 Sec", "LilMati"),
  },
  // Its blast (ADR 0126), the user's pick: cut where the bang starts (0.3 s of
  // fuse swell before it), so it lands on the Tick the Characters go down.
  {
    kind: "oneshot",
    out: "segment/bomb_blast.ogg",
    src: "freesound/402011__eardeer__explosion_mid_fuse_1.wav",
    origin: freesound(402011, "explosion_mid_fuse_1", "eardeer", "CC-BY 4.0"),
    start: 0.3,
  },
  // A Shooter's shot (ADR 0119), the user's pick: heard where the ball leaves the barrel.
  {
    kind: "oneshot",
    out: "segment/shooter_fire.ogg",
    src: "freesound/184651__isaac200000__cannon5.wav",
    origin: freesound(184651, "Cannon5", "Isaac200000"),
  },

  // --- environment -----------------------------------------------------------------
  { kind: "loop", out: "environment/wind_day_loop.ogg", ...WIND, start: 5, seconds: 30, crossfade: 4, lufs: -24, stereo: true },
  // Night's wind: the same wind, lower and quieter, under the crickets.
  {
    kind: "loop",
    out: "environment/wind_night_loop.ogg",
    ...WIND,
    start: 5,
    seconds: 30,
    crossfade: 4,
    lufs: -28,
    stereo: true,
    filter: "lowpass=f=900",
  },
  { kind: "loop", out: "environment/birds_loop.ogg", ...BIRDS, start: 10, seconds: 45, crossfade: 4, lufs: -26 },
  { kind: "loop", out: "environment/crickets_loop.ogg", ...CRICKETS, start: 20, seconds: 45, crossfade: 4, lufs: -28, stereo: true },

  // --- match: calls and jingles ----------------------------------------------------------
  ...(
    [
      ["count_3", "3"],
      ["count_2", "2"],
      ["count_1", "1"],
      ["go", "go"],
      ["hurry_up", "hurry_up"],
      ["time_over", "time_over"],
      ["final_round", "final_round"],
      ["you_win", "you_win"],
      ["congratulations", "congratulations"],
    ] as const
  ).map(([slot, file]): Job => ({ kind: "copy", out: `match/${slot}.ogg`, src: `kenney/voiceover-pack/Male/${file}.ogg`, origin: VOICE })),
  { kind: "oneshot", out: "match/checkpoint.ogg", ...CHECKPOINT },
  { kind: "copy", out: "match/qualified.ogg", src: "kenney/music-jingles/Audio/Steel jingles/jingles_STEEL07.ogg", origin: JINGLES },
  { kind: "copy", out: "match/round_end.ogg", src: "kenney/music-jingles/Audio/Hit jingles/jingles_HIT15.ogg", origin: JINGLES },
  { kind: "copy", out: "match/results.ogg", src: "kenney/music-jingles/Audio/Pizzicato jingles/jingles_PIZZI07.ogg", origin: JINGLES },
  { kind: "copy", out: "match/results_win.ogg", src: "kenney/music-jingles/Audio/Sax jingles/jingles_SAX07.ogg", origin: JINGLES },

  // --- ui --------------------------------------------------------------------------------
  ...copies("ui", "click", INTERFACE, range(5).map((i) => `kenney/interface-sounds/Audio/click_${pad3(i + 1)}.ogg`)),
  ...copies("ui", "confirm", INTERFACE, range(4).map((i) => `kenney/interface-sounds/Audio/confirmation_${pad3(i + 1)}.ogg`)),
  ...copies("ui", "back", INTERFACE, range(4).map((i) => `kenney/interface-sounds/Audio/back_${pad3(i + 1)}.ogg`)),
  ...copies("ui", "toggle", INTERFACE, range(4).map((i) => `kenney/interface-sounds/Audio/toggle_${pad3(i + 1)}.ogg`)),
  ...copies("ui", "tick", INTERFACE, [1, 2, 4].map((n) => `kenney/interface-sounds/Audio/tick_${pad3(n)}.ogg`)),

  // --- music (generated by the game's author, ADR 0087 amendment) ---------------------------
  { kind: "music", out: "music/lobby_0.ogg", src: "freesound/MUSIC-Bouncy Lobby Bounce.m4a", origin: generated("Suno", "Bouncy Lobby Bounce") },
  { kind: "music", out: "music/lobby_1.ogg", src: "freesound/MUSIC-Bouncy Lobby Bounce (1).m4a", origin: generated("Suno", "Bouncy Lobby Bounce (take 2)") },
  { kind: "music", out: "music/lobby_2.ogg", src: "freesound/MUSIC-Bouncy Lobby Fun.m4a", origin: generated("Suno", "Bouncy Lobby Fun") },
  { kind: "music", out: "music/round_0.ogg", src: "freesound/MUSIC-gameplay_2.m4a", origin: generated("Suno", "Gameplay 2") },
  { kind: "music", out: "music/round_1.ogg", src: "freesound/MUSIC-gameplay_3.m4a", origin: generated("Suno", "Gameplay 3") },
  { kind: "music", out: "music/round_2.ogg", src: "freesound/music-gameplay_song.m4a", origin: generated("Suno", "Gameplay song") },
  { kind: "music", out: "music/round_3.ogg", src: "freesound/music_gameplay_song_1.m4a", origin: generated("Suno", "Gameplay song (take 2)") },
  { kind: "music", out: "music/round_4.ogg", src: "freesound/Music-stableaudio.wav", origin: generated("Stable Audio", "Gameplay (Stable Audio)") },
];
