import styles from "./ActivityDot.module.css";

export interface ActivityDotProps {
  active?: boolean;
  className?: string;
}

/** Presence indicator — avatar corners, typing rows, party chips. */
export function ActivityDot({ active = false, className }: ActivityDotProps) {
  return <span className={[styles.dot, active && styles.active, className].filter(Boolean).join(" ")} />;
}
