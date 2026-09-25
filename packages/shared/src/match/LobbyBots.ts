import { DEFAULT_BOT_LEVEL } from "../tuning/match.js";

/**
 * How well a Lobby's Bots play (ADR 0129): the host picks one level, and each
 * Bot draws its own spread around it (M17 ticket 08). Lower-case on the wire,
 * like a Round type; a Screen shows it upper-case.
 */
export type BotLevel = "easy" | "normal" | "hard";

/** Every level, in the order a Lobby offers them. */
export const BOT_LEVELS: readonly BotLevel[] = ["easy", "normal", "hard"];

/**
 * The host's Bot settings for a Lobby (M17 ticket 10, ADR 0129) — one shape
 * for both kinds of Lobby. A private Lobby's host picks how many Bots (`max`,
 * with `enabled` meaning "more than none"); a public Lobby's host ticks
 * whether Bots are allowed at all and caps them. Either way the places left
 * open when the Round starts fill up to `max` ({@link botsToFill}).
 */
export interface LobbyBots {
  enabled: boolean;
  /** The most Bots that fill. Never more than the Lobby's capacity less its host. */
  max: number;
  level: BotLevel;
}

/**
 * A fresh Lobby's settings: no Bots, until its host says otherwise. `max`
 * starts at the most there could be, so a public Lobby's host who ticks Bots
 * on fills the Lobby without also having to find the cap.
 */
export const defaultLobbyBots = (maxPlayers: number): LobbyBots => ({
  enabled: false,
  max: Math.max(0, maxPlayers - 1),
  level: DEFAULT_BOT_LEVEL,
});

/**
 * Why `value` is not a Lobby's Bot settings for a Lobby of `maxPlayers`, or
 * `undefined` when it is. The one rule the Lobby message and `POST /lobbies`
 * both hold a host's choice to. `max` stops one short of capacity: the host
 * always holds a seat.
 */
export const invalidLobbyBotsReason = (value: unknown, maxPlayers: number): string | undefined => {
  if (typeof value !== "object" || value === null) return "bots must be an object";
  const { enabled, max, level } = value as Record<string, unknown>;
  if (typeof enabled !== "boolean") return "bots.enabled must be a boolean";
  const ceiling = Math.max(0, maxPlayers - 1);
  if (typeof max !== "number" || !Number.isInteger(max) || max < 0 || max > ceiling) {
    return `bots.max must be a whole number 0–${ceiling}`;
  }
  if (!BOT_LEVELS.includes(level as BotLevel)) return `bots.level must be one of ${BOT_LEVELS.join(", ")}`;
  return undefined;
};

/**
 * How many Bots fill a Lobby with `freeSeats` places left open (ADR 0129):
 * `min(max, free)` when Bots are on, none when they are off. `freeSeats` is
 * capacity less sockets and live Reservations, so a seat kept for a Party
 * member is never a Bot's.
 */
export const botsToFill = (bots: LobbyBots, freeSeats: number): number =>
  bots.enabled ? Math.max(0, Math.min(bots.max, freeSeats)) : 0;
