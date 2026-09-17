/**
 * Flash messages — the `FriendRequestAlert` mock's toasts, as a global
 * transient channel. Any Screen pushes (`flash("Invite sent.")`); one
 * `<FlashHost>` at the app shell renders the stack on every authed route, so
 * a confirmation survives the navigation that caused it — no Screen owns an
 * inline "success" line anymore.
 *
 * Success/info flashes auto-dismiss; an error flash is sticky until
 * dismissed — a failure must never vanish before it is read. Actionable
 * social traffic (friend requests, Lobby invites) is not flashes — those
 * stay as sticky alerts in `<FriendAlerts>`, which shares the host's
 * corner.
 */
export type FlashTone = "success" | "info" | "error";

export interface Flash {
  id: number;
  title: string;
  tone: FlashTone;
}

/** How long a success/info flash stays up before dismissing itself. */
export const FLASH_TTL_MS = 4_500;

/** The stack never grows past this — the oldest flash drops first. */
export const MAX_FLASHES = 4;

let nextId = 1;
let flashes: Flash[] = [];
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

export const subscribeFlashes = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * The current stack — a stable reference until the next push/dismiss, so
 * `useSyncExternalStore` never re-renders for nothing.
 */
export const getFlashesSnapshot = (): Flash[] => flashes;

/** Pushes a flash, returning its id. */
export const flash = (title: string, tone: FlashTone = "success"): number => {
  const id = nextId++;
  flashes = [...flashes, { id, title, tone }];
  if (tone !== "error") {
    timers.set(
      id,
      setTimeout(() => dismissFlash(id), FLASH_TTL_MS),
    );
  }
  while (flashes.length > MAX_FLASHES) {
    dismissFlash(flashes[0]!.id);
  }
  emit();
  return id;
};

export const dismissFlash = (id: number): void => {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  if (flashes.some((entry) => entry.id === id)) {
    flashes = flashes.filter((entry) => entry.id !== id);
    emit();
  }
};

/** Empties the stack and stops every pending timer (tests, unmount). */
export const clearFlashes = (): void => {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  flashes = [];
  emit();
};
