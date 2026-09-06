import type { ReactNode } from "react";
import styles from "./Row.module.css";
import { landInStyles, staggerDelay } from "../../motion";

export interface RowProps {
  /** Rank number, avatar, activity dot — whatever leads the row. */
  leading?: ReactNode;
  label: ReactNode;
  /** Stat(s), a toggle, a badge — whatever trails the row. */
  trailing?: ReactNode;
  /**
   * `flat` (default) — §2.5's own ranked-list row: no per-row card chrome,
   * a hairline divider (Results/Leaderboard/Match history/Stat tiles).
   * `card` — the bordered, avatar-led row validated for
   * `<LobbyPlayerList>`/`<CharacterPickList>`.
   */
  surface?: "flat" | "card";
  isHost?: boolean;
  /** "This is you" — a neutral-weight left edge, never a decorative color. */
  isOwnRow?: boolean;
  /** DNF — a different KIND of row, not a color swap on the same one. */
  variant?: "default" | "dnf";
  interactive?: boolean;
  onClick?: () => void;
  /** Stagger index for list entrance (§2.5, ~40ms/row) — omit to skip it. */
  enterIndex?: number;
  className?: string;
}

/** `<ResultsRow>` / `<LeaderboardRow>` / `<MatchHistoryRow>` / `<LobbyPlayerList>` row. */
export function Row({
  leading,
  label,
  trailing,
  surface = "flat",
  isHost = false,
  isOwnRow = false,
  variant = "default",
  interactive = false,
  onClick,
  enterIndex,
  className,
}: RowProps) {
  const classes = [
    styles.row,
    styles[surface],
    isHost && styles.isHost,
    isOwnRow && styles.isOwnRow,
    variant === "dnf" && styles.dnf,
    interactive && styles.interactive,
    enterIndex !== undefined && landInStyles.landIn,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const style = enterIndex !== undefined ? staggerDelay(enterIndex) : undefined;
  const content = (
    <>
      {leading}
      <span className={styles.label}>{label}</span>
      {trailing}
    </>
  );

  if (interactive) {
    return (
      <button type="button" className={classes} style={style} onClick={onClick}>
        {content}
      </button>
    );
  }
  return (
    <div className={classes} style={style}>
      {content}
    </div>
  );
}
