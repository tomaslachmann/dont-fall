import styles from "./HostBadge.module.css";

export interface HostBadgeProps {
  className?: string;
}

/** "HOST" marker beside a nickname — §2.3/§2.7, a bordered text pill. */
export function HostBadge({ className }: HostBadgeProps) {
  return <span className={[styles.badge, className].filter(Boolean).join(" ")}>HOST</span>;
}
