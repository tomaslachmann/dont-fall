import { startGame, type GameHandle } from "./game.js";

/**
 * The client's entry point. Until M4 this file *was* the game; now it is only
 * the one caller of {@link startGame} — the same job `<GameCanvas>` takes over
 * when React arrives (M4 ticket 06, ADR 0008), which is why the game's config
 * and its match-end/exit reports already cross a typed boundary here rather
 * than being read off the page and the URL from inside the loop.
 */
const mount = document.getElementById("game")!;

// Track Builder's Playtest button (`?track=<id>` on this page's own URL) —
// read here, at the edge, and passed in. Absent for an ordinary player, who
// connects exactly as before.
const trackId = new URLSearchParams(location.search).get("track") ?? undefined;

let game: GameHandle | null = null;
/** The shell's own "couldn't start" notice, if one is showing. */
let failureNotice: HTMLElement | null = null;

const stop = (): void => {
  game?.stop();
  game = null;
};

const start = async (): Promise<void> => {
  stop();
  // Clear anything a previous failed start left behind — the game removes what
  // it created, but the error notice below is this shell's own, and a canvas
  // drawn on top of a stale "failed to connect" is worse than either alone.
  failureNotice?.remove();
  failureNotice = null;
  game = await startGame({
    mount,
    ...(trackId === undefined ? {} : { trackId }),
    // The game keeps its frozen last frame and its own "connection lost" HUD;
    // there is nowhere to route to until the Screens land (M4 ticket 06), so
    // this shell only records it. React will stop the game and show a Screen.
    onExit: (reason) => console.warn(`DON'T FALL: game exited — ${reason}`),
  });
};

// Bootstrap failures (server unreachable, track-service unreachable, a
// missing/invalid Revision) must surface somewhere visible instead of
// silently rejecting behind `void` — the only feedback otherwise being an
// unhandled-rejection console entry while the page sits blank forever (code
// review, ticket 11). `startGame` has already released whatever it acquired.
const boot = (): void => {
  void start().catch((err: unknown) => {
    console.error("DON'T FALL: failed to start", err);
    failureNotice = document.createElement("div");
    failureNotice.textContent = `DON'T FALL — failed to connect\n${(err as Error).message}\nreload to retry`;
    Object.assign(failureNotice.style, {
      position: "fixed",
      top: "12px",
      left: "12px",
      font: "12px/1.4 ui-monospace, monospace",
      color: "#8ba0b8",
      whiteSpace: "pre",
    });
    mount.append(failureNotice);
  });
};

boot();

// A dev-only handle for exercising the teardown boundary by hand — "stop the
// game and start it again in the same page session" is M4 ticket 01's own
// acceptance criterion, and until a Screen can route away there is no other
// way to trigger it. Stripped from a production build.
if (import.meta.env.DEV) {
  Object.assign(window, { dontFall: { stop, restart: boot } });
}
