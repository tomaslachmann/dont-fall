import type { HTMLAttributes } from "react";
import styles from "./Panel.module.css";

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * A colored top edge tied to something this panel already means
   * (`presence` = checkpoint-cyan, the same hue as avatar rings/dots;
   * `go` = the hue that already means "advance"). Not every panel needs
   * one — leaving it `"none"` is a deliberate choice, not an omission.
   */
  accent?: "none" | "presence" | "go";
}

/** Static furniture panel — Lobby columns, Settings content, etc. */
export function Panel({ accent = "none", className, ...rest }: PanelProps) {
  const classes = [
    styles.panel,
    accent !== "none" && styles.accentTop,
    accent === "presence" && styles.accentPresence,
    accent === "go" && styles.accentGo,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <div className={classes} {...rest} />;
}
