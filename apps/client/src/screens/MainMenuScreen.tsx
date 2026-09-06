import { useNavigate } from "react-router";
import { Button, ExtrudedText } from "@dont-fall/ui";
import styles from "./MainMenuScreen.module.css";

/** The Screen the client now opens on, instead of straight into a running game (M4 ticket 06). */
export function MainMenuScreen() {
  const navigate = useNavigate();

  return (
    <div className={styles.stage}>
      <div className={styles.hero}>
        <h1 className={styles.wordmark}>
          <ExtrudedText color="var(--df-color-accent)" depthColor="var(--df-color-accent-depth)">
            Don&apos;t Fall
          </ExtrudedText>
        </h1>
        <p className={styles.tagline}>
          Dash, bump, and Fall your way across a course built to knock you down. Up to twelve
          players, one Checkpoint at a time.
        </p>
        <Button onClick={() => navigate("/play")}>Play</Button>
      </div>
    </div>
  );
}
