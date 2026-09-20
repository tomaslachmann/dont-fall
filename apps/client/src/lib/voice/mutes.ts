/**
 * Whom this Player has Muted (ADR 0111), as the Screens read it.
 *
 * One module-level owner, like the voice socket beside it, because two
 * Screens show the same list and neither owns it: the pause sheet sets a
 * Mute, and a Lobby card wears the MUTED chip for the same Account. A per-
 * Screen copy would mean a Mute set mid-Round did not show on the Lobby you
 * walked back into.
 *
 * The API is the authority and answers every write with the whole list, so
 * nothing here merges: a write replaces. What is held between the click and
 * the answer is optimistic, and a failed write puts the old list back — a
 * Mute that silently did not take is worse than one that visibly refused.
 */
import { useSyncExternalStore } from "react";
import { getMutes, setMuted as putMuted } from "../api/voice.js";
import { flash } from "../flash.js";

/** Muted Account ids. A stable reference until the next change, for `useSyncExternalStore`. */
let muted: readonly string[] = [];
const listeners = new Set<() => void>();
/** Whether the list has been read from the API at all this session. */
let loaded = false;
let loading: Promise<void> | null = null;

/**
 * Whatever came back, as a list this store can hold. The API answers
 * `{ muted: string[] }`, but "the API answers X" is a claim about a network,
 * not a fact — and a body without it would otherwise put `undefined` in the
 * store, where every reader would then crash on it. An unreadable answer is
 * an empty list: the relay applies the stored Mutes regardless, so nothing is
 * heard that should not be; only the rows go blank.
 */
const asMuteList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];

const publish = (next: readonly string[]): void => {
  muted = next;
  for (const listener of [...listeners]) listener();
};

export const subscribeMutes = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getMutesSnapshot = (): readonly string[] => muted;

/**
 * Reads the list once per session. Called when a Screen that shows Mutes is
 * first opened rather than at sign-in: most visits never open one, and this
 * is one more request on a path that already holds the app for the Track art
 * (ADR 0105).
 *
 * A failure is quiet. Not being able to *list* who you Muted is not worth a
 * sticky error over a Round: the relay applies the stored Mutes either way,
 * so they still work — the rows just cannot show which.
 */
export const loadMutes = async (): Promise<void> => {
  if (loaded || loading !== null) return loading ?? undefined;
  loading = getMutes()
    .then((body) => {
      loaded = true;
      publish(asMuteList(body?.muted));
    })
    .catch(() => {
      // Left unloaded on purpose, so opening the sheet again tries again.
    })
    .finally(() => {
      loading = null;
    });
  return loading;
};

/**
 * Mutes or unmutes one Player. Shows at once and settles on the API's own
 * answer; a failure puts the list back and says so, because a Mute that did
 * not take is the one case where being quiet would be a lie.
 */
export const setMute = async (accountId: string, next: boolean): Promise<void> => {
  const before = muted;
  publish(next ? [...muted.filter((id) => id !== accountId), accountId] : muted.filter((id) => id !== accountId));
  try {
    const body = await putMuted(accountId, next);
    loaded = true;
    publish(asMuteList(body?.muted));
  } catch (err) {
    publish(before);
    flash(`Couldn't ${next ? "mute" : "unmute"} that bean: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
};

/** Forgets everything — sign-out, so the next Account does not inherit these. */
export const clearMutes = (): void => {
  loaded = false;
  publish([]);
};

/** Whom this Player has Muted, live. */
export const useMutes = (): { muted: readonly string[]; isMuted: (accountId: string) => boolean } => {
  const list = useSyncExternalStore(subscribeMutes, getMutesSnapshot, getMutesSnapshot);
  return { muted: list, isMuted: (accountId: string) => list.includes(accountId) };
};
