import { Screen } from "@dont-fall/ui";
import styles from "./LoadingScreen.module.css";

/**
 * The wait between "I confirmed Ready on Standings" and the next Round's
 * Countdown actually starting (M7 ticket 11, ADR 0051) — covers both
 * waiting on other Players' own confirmations (or the timeout) and this
 * client's own local Track rebuild. No server-replicated phase backs this;
 * it is purely this client's own read of "I've confirmed, `phase` hasn't
 * caught up to COUNTDOWN yet" (`GameCanvas.tsx`). Non-interactive, no
 * timer of its own — same "renders the wait, does not time it" principle
 * ticket 06 already established for Standings.
 */
export function LoadingScreen() {
  return (
    <Screen>
      <div className={styles.loading}>
        <span className={styles.spinner} aria-hidden="true" />
        <p className={styles.label}>Loading next Round…</p>
      </div>
    </Screen>
  );
}
