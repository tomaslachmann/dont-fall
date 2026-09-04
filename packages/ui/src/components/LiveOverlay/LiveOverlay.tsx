import type { ReactNode } from "react";
import styles from "./LiveOverlay.module.css";

export interface LiveOverlayProps {
  children: ReactNode;
  /** Honest label for the placeholder "live scene" backdrop, e.g. `"<GameCanvas> — already live, input locked"`. Omit for no label. */
  sceneLabel?: string;
  /** Fades the backdrop pattern in — the scene is already live, so this never dims heavily. */
  isSceneLive?: boolean;
  className?: string;
}

/** `<CountdownOverlay>` / `<BetOverlay>` / `<SpectateOverlay>` shared shape. */
export function LiveOverlay({ children, sceneLabel, isSceneLive = true, className }: LiveOverlayProps) {
  return (
    <div className={[styles.stage, className].filter(Boolean).join(" ")}>
      <div className={[styles.scene, isSceneLive && styles.isLive].filter(Boolean).join(" ")}>
        {sceneLabel && <span className={styles.sceneLabel}>{sceneLabel}</span>}
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
