import { ExtrudedText, Screen } from "@dont-fall/ui";
import styles from "./LoadingScreen.module.css";

export interface LoadingScreenProps {
  label?: string;
  /**
   * The Track the next Round runs on (ADR 0085) — when known, the wait
   * becomes the full-page Round loader: the Track's screenshot under a
   * scrim, its name big in the wordmark's own chunky treatment, the
   * spinner and label under it. Absent (connecting, saving, results),
   * the plain wait, as before.
   */
  trackName?: string;
  /**
   * That Track's screenshot URL — shown when given, the plain surface
   * when not. Kept separate from `trackName` so a Track without a
   * captured screenshot still gets its name big.
   */
  thumbnailUrl?: string;
}

/**
 * A non-interactive wait with a spinner — "renders the wait, does not time
 * it" (M7 ticket 06's principle for Standings). The default covers the wait
 * between "I confirmed Ready on Standings" and the next Round's Countdown
 * actually starting (M7 ticket 11, ADR 0051): other Players' confirmations
 * (or the timeout) plus this client's own local Track rebuild. The `/lobby`
 * route reuses it with its own label while the socket is still connecting
 * (ADR 0056) — same shape of wait, different reason.
 */
export function LoadingScreen({ label = "Loading next Round…", trackName, thumbnailUrl }: LoadingScreenProps) {
  if (trackName === undefined) {
    return (
      <Screen>
        <div className={styles.loading}>
          <span className={styles.spinner} aria-hidden="true" />
          <p className={styles.label}>{label}</p>
        </div>
      </Screen>
    );
  }
  return (
    <Screen>
      {thumbnailUrl !== undefined && (
        <img
          className={styles.backdrop}
          src={thumbnailUrl}
          alt=""
          aria-hidden="true"
          onError={(e) => {
            // A screenshot that won't load leaves the plain surface — the
            // name and the wait below it never depend on it.
            e.currentTarget.hidden = true;
          }}
        />
      )}
      <div className={styles.scrim} aria-hidden="true" />
      <div className={styles.hero}>
        <p className={styles.kicker}>NEXT ROUND</p>
        <h1 className={styles.title}>
          <ExtrudedText color="var(--df-color-accent)" depthColor="var(--df-color-accent-depth)">
            {trackName}
          </ExtrudedText>
        </h1>
        <span className={styles.spinner} aria-hidden="true" />
        <p className={styles.heroLabel}>{label}</p>
      </div>
    </Screen>
  );
}
