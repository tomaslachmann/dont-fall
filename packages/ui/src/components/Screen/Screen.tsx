import type { ReactNode } from "react";
import styles from "./Screen.module.css";

export interface ScreenProps {
  children: ReactNode;
  className?: string;
}

/**
 * A full-viewport, opaque surface for a Screen that sits over an
 * already-mounted `<GameCanvas>` — Lobby, Loading, Standings (ADR 0051) —
 * without showing the live Match behind it. The opposite case from
 * `<LiveOverlay>`, which is for content genuinely over a live scene
 * (Countdown, Bet, Spectate) and stays exactly that.
 *
 * What renders behind the content here is deliberately undecided (ADR
 * 0051) — a plain surface color only, no placeholder pattern, no scene
 * label. A future background (a looping render, a static illustration,
 * whatever survives that open question) replaces this fill, not the
 * component itself.
 */
export function Screen({ children, className }: ScreenProps) {
  return <div className={[styles.screen, className].filter(Boolean).join(" ")}>{children}</div>;
}
