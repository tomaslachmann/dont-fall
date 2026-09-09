import { useEffect } from "react";
import { Button } from "@dont-fall/ui";
import styles from "./PracticeHud.module.css";

export interface PracticeHudProps {
  trackName: string;
  finished: boolean;
  onBack: () => void;
}

/**
 * The whole React surface of a free-roam practice session (m8.1 ticket 03):
 * a hint bar, a finish toast, and a way back. Deliberately not the match
 * HUD with pieces hidden — nothing here exists in a Match (no Rounds, no
 * clock, no standings), and nothing from a Match exists here. The game
 * loop never runs through this; it only learns `finished` through
 * `onPracticeState`.
 */
export function PracticeHud({ trackName, finished, onBack }: PracticeHudProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === "Escape") onBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBack]);

  return (
    <div className={styles.hud}>
      <div className={styles.bar}>
        <span className={styles.mode}>FREE ROAM</span>
        <span className={styles.track}>{trackName}</span>
        <span className={styles.hint}>WASD move · Space jump · Shift dash · F hit · G grab · click to look · Esc back</span>
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
      {finished && <p className={styles.toast}>Finished — keep running</p>}
    </div>
  );
}
