import { Screen } from "@dont-fall/ui";
import styles from "./LoadingScreen.module.css";

/**
 * A non-interactive wait with a spinner — "renders the wait, does not time
 * it" (M7 ticket 06's principle for Standings). The default covers the wait
 * between "I confirmed Ready on Standings" and the next Round's Countdown
 * actually starting (M7 ticket 11, ADR 0051): other Players' confirmations
 * (or the timeout) plus this client's own local Track rebuild. The `/lobby`
 * route reuses it with its own label while the socket is still connecting
 * (ADR 0056) — same shape of wait, different reason.
 */
export function LoadingScreen({ label = "Loading next Round…" }: { label?: string }) {
  return (
    <Screen>
      <div className={styles.loading}>
        <span className={styles.spinner} aria-hidden="true" />
        <p className={styles.label}>{label}</p>
      </div>
    </Screen>
  );
}
