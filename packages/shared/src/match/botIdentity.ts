import { BODY_COLOR_COUNT, HATS, SKINS } from "../cosmetics.js";
import { NICKNAME_MAX_LENGTH } from "../net/protocol.js";
import { BOT_SKIN_CHANCE } from "../tuning/match.js";
import type { LobbyPlayer } from "./Lobby.js";

/**
 * How a Bot looks on every Screen (ADR 0129: "a Bot looks like a Player"): a
 * name, and a Colour or a Skin with a Hat. Exactly the roster fields an
 * Account fills for a Player, so nothing downstream can tell the two apart.
 */
export type BotIdentity = Pick<LobbyPlayer, "nickname" | "color" | "skin" | "hat">;

/**
 * Names a Bot is called by. They read like the display names people pick,
 * not like a label: mixed case, the odd digit or underscore, some plain first
 * names, because a roster of `Bot 1`…`Bot 11` would mark every one of them.
 * Every one fits {@link NICKNAME_MAX_LENGTH}.
 */
export const BOT_NICKNAMES: readonly string[] = [
  "pixelpeach",
  "Tomik",
  "noodlearms",
  "Maja_R",
  "wobblyboi",
  "Kiwi",
  "SirTumbles",
  "jellybeanz",
  "lukas.v",
  "Anicka",
  "notafrog",
  "mr_pancake",
  "Fernando",
  "bouncehouse",
  "Zuzka",
  "TheRealGus",
  "sleepyhead99",
  "marmalade",
  "Ondra",
  "clumsyclaire",
  "beanbag",
  "Petra_K",
  "wiggles",
  "DizzyDan",
  "cheesecake",
  "Mikey",
  "ohnomypants",
  "Lenka",
  "floppyfish",
  "Kuba_07",
  "gumdrop",
  "stumblebee",
  "Rosie",
  "noscopeNora",
  "potatojam",
  "Vojta",
  "tumbleweed",
  "sprinkles",
  "BigJim",
  "cozybean",
  "Hanka",
  "rubberduck",
  "Filip",
  "puddlejumper",
  "mintchip",
  "Eliska",
  "zoomzoom",
  "captainclumsy",
  "Theo",
  "waffles",
  "Dominik",
  "bubblegum",
  "slipnslide",
  "Karolina",
  "gigglesnort",
  "Matej",
  "pinecone",
  "hotsauce",
  "Bara",
  "lil_noodle",
  "Radek",
  "cupcakeqt",
  "fallguy_irl",
  "Simona",
];

/**
 * A seeded source of `[0, 1)` (mulberry32 over an FNV-1a hash of `seed`).
 * `Math.random()` is never used for a Bot (ADR 0129): the same seed must make
 * the same Bots, so a suite's Lobby fills the same way every run.
 */
const seededRandom = (seed: string): (() => number) => {
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 0x01000193);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
};

const pick = <T>(random: () => number, from: readonly T[]): T => from[Math.floor(random() * from.length)]!;

/**
 * `count` Bots' identities, drawn from `seed` (M17 ticket 10, ADR 0129).
 *
 * Names are drawn without repeats and never one already `taken` in the Lobby
 * (compared ignoring case), so no two beans in a roster share a name. Should
 * a Lobby ever outnumber the list, a drawn name takes a number, as a name
 * someone already has does anywhere else. A Bot wears a Colour or a Skin
 * ({@link BOT_SKIN_CHANCE}) and always a Hat, from the whole catalogue: a Bot
 * has no level, so nothing in the wardrobe is locked to it.
 */
export const botIdentities = (seed: string, count: number, taken: Iterable<string> = []): BotIdentity[] => {
  const random = seededRandom(seed);
  const used = new Set<string>();
  for (const name of taken) used.add(name.toLowerCase());
  const free = BOT_NICKNAMES.filter((name) => !used.has(name.toLowerCase()));
  const identities: BotIdentity[] = [];
  for (let i = 0; i < count; i += 1) {
    let nickname: string;
    if (free.length > 0) {
      nickname = free.splice(Math.floor(random() * free.length), 1)[0]!;
    } else {
      const base = pick(random, BOT_NICKNAMES);
      let n = 2;
      while (used.has(`${base}${n}`.toLowerCase())) n += 1;
      nickname = `${base}${n}`.slice(0, NICKNAME_MAX_LENGTH);
    }
    used.add(nickname.toLowerCase());
    const wearsSkin = random() < BOT_SKIN_CHANCE;
    identities.push({
      nickname,
      color: wearsSkin ? null : Math.floor(random() * BODY_COLOR_COUNT),
      skin: wearsSkin ? pick(random, SKINS).id : null,
      hat: pick(random, HATS).id,
    });
  }
  return identities;
};
