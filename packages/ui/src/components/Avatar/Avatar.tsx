import styles from "./Avatar.module.css";
import { ActivityDot } from "../ActivityDot";

export interface AvatarProps {
  /** 1-2 letter initials — no photo/generic-icon-pack avatars anywhere yet. */
  initials: string;
  isHost?: boolean;
  /** Presence dot in the corner — omit to show no dot at all. */
  active?: boolean;
  showDot?: boolean;
  className?: string;
}

/** `<LobbyPlayerList>` / `<CharacterPickList>` row avatar. */
export function Avatar({ initials, isHost = false, active = false, showDot = true, className }: AvatarProps) {
  return (
    <div className={[styles.avatar, isHost && styles.isHost, className].filter(Boolean).join(" ")}>
      {initials}
      {showDot && <ActivityDot active={active} className={[styles.dot].filter(Boolean).join(" ")} />}
    </div>
  );
}
