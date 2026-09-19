/**
 * An Account's role — who may do what with it. `"player"` is everyone;
 * `"admin"` is the second enum reserved for future administration tooling.
 * There is no writer yet: every Account is created a player, and nothing
 * promotes one. Carried on the Account responses so the UI already receives
 * it, but nothing renders on it.
 */
export const ACCOUNT_ROLES = ["player", "admin"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Every Account starts here — and anything unreadable falls back here, never up to admin. */
export const DEFAULT_ACCOUNT_ROLE: AccountRole = "player";

/**
 * A stored value into a role — fail-closed: only `"admin"` reads as admin,
 * everything else (including a hand-edited DB's garbage) is a player.
 */
export const resolveAccountRole = (value: unknown): AccountRole => (value === "admin" ? "admin" : "player");

/**
 * A Player's uploaded avatar (ADR 0110): the browser crops the picture to a
 * centred square and scales it to this many pixels a side before sending it,
 * so the API stores one small image per Account and serves it as it is.
 */
export const AVATAR_SIZE_PX = 256;

/** The one format an uploaded avatar is sent and stored in. */
export const AVATAR_MIME = "image/webp";

/** How an upload arrives in its JSON body: a data URL of {@link AVATAR_MIME}. */
export const AVATAR_DATA_URL_PREFIX = "data:image/webp;base64,";

/** The largest avatar the API stores, decoded — well above a 256² WebP, far below anything else. */
export const MAX_AVATAR_BYTES = 200_000;

/**
 * A support code (ADR 0110): what the error screen shows and the API files a
 * client error under — `DF-` then four and two characters from an alphabet
 * with nothing that reads as something else (no 0/O, 1/I/L).
 */
export const SUPPORT_CODE_PATTERN = /^DF-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{2}$/;
export const SUPPORT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** The kinds of failure the error screen tells apart — what a report is filed as. */
export const CLIENT_ERROR_KINDS = ["connection", "crash", "kicked"] as const;
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];
