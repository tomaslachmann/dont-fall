import type { FriendRequestView, LobbyInviteView } from "@dont-fall/shared";
import { CrossIcon, TickIcon } from "../ui/AnswerIcons";
import Avatar from "../ui/Avatar";
import JellyButton from "../ui/JellyButton";
import { skinForPlayerId } from "../lib/avatarSkins.js";
import s from "./FriendAlerts.module.css";

export interface FriendAlertsProps {
  requests: FriendRequestView[];
  invites: LobbyInviteView[];
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  onJoinInvite: (invite: LobbyInviteView) => void;
  onDismissInvite: (id: string) => void;
}

/**
 * The menu's live friend toasts (M9 ticket 12) — the `FriendRequestAlert`
 * mock's right column, wired: one toast per pending request (answerable in
 * place) and one per Lobby invite (JOIN or dismiss). Renders nothing when
 * there is nothing to answer.
 */
export default function FriendAlerts({
  requests,
  invites,
  onAccept,
  onDecline,
  onJoinInvite,
  onDismissInvite,
}: FriendAlertsProps) {
  if (requests.length === 0 && invites.length === 0) return null;
  return (
    <div className={s.alerts} aria-live="polite">
      {requests.map((request) => (
        <div key={request.id} className={s.toast}>
          <Avatar skin={skinForPlayerId(request.fromAccountId)} size={3.75} />
          <span className={s.toastText}>
            <span className={s.toastKicker}>FRIEND REQUEST</span>
            <span className={s.toastTitle}>{request.fromDisplayName.toUpperCase()} WANTS IN</span>
          </span>
          <span className={s.toastActions}>
            <button
              type="button"
              className={[s.action, s.accept].join(" ")}
              aria-label={`Accept ${request.fromDisplayName}`}
              onClick={() => onAccept(request.id)}
            >
              <TickIcon />
            </button>
            <button
              type="button"
              className={[s.action, s.decline].join(" ")}
              aria-label={`Decline ${request.fromDisplayName}`}
              onClick={() => onDecline(request.id)}
            >
              <CrossIcon />
            </button>
          </span>
        </div>
      ))}
      {invites.map((invite) => (
        <div key={invite.id} className={[s.toast, s.toastDark].join(" ")}>
          <Avatar skin={skinForPlayerId(invite.fromAccountId)} size={3.1} />
          <span className={s.toastText}>
            <span className={s.toastKicker}>LOBBY INVITE</span>
            <span className={s.toastTitle}>{invite.fromDisplayName.toUpperCase()} INVITED YOU</span>
          </span>
          <JellyButton variant="pill" centered onClick={() => onJoinInvite(invite)}>
            JOIN
          </JellyButton>
          <button
            type="button"
            className={[s.action, s.decline].join(" ")}
            aria-label={`Dismiss invite from ${invite.fromDisplayName}`}
            onClick={() => onDismissInvite(invite.id)}
          >
            <CrossIcon />
          </button>
        </div>
      ))}
    </div>
  );
}
