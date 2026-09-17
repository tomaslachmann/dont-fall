/**
 * Whether a Match currently owns the screen — `<GameCanvas>` sets this on
 * a Match mount and clears it on unmount (a practice boot is not a game
 * start and leaves it alone). The global social alerts read it: a Lobby
 * invite stays a sticky alert on every menu route, but once the game
 * starts it steps aside for the game.
 */
let active = false;
const listeners = new Set<() => void>();

export const subscribeGameActive = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getGameActiveSnapshot = (): boolean => active;

export const setGameActive = (next: boolean): void => {
  if (next === active) return;
  active = next;
  for (const listener of listeners) listener();
};
