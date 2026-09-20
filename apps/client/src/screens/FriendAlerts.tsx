import { PARTY_MAX_SIZE, type FriendRequestView, type LobbyInviteView, type PartyInviteView } from "@dont-fall/shared";
import { CrossIcon, TickIcon } from "../ui/AnswerIcons";
import Avatar from "../ui/Avatar";
import JellyButton from "../ui/JellyButton";
import { avatarLook, type AvatarLook } from "../lib/avatar.js";
import s from "./FriendAlerts.module.css";

/** Who took you out of their Party (ADR 0112) — the Party mock's toast wears their bean. */
export interface PartyRemoval {
  byName: string;
  look: AvatarLook;
}

export interface FriendAlertsProps {
  requests: FriendRequestView[];
  invites: LobbyInviteView[];
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  onJoinInvite: (invite: LobbyInviteView) => void;
  onDismissInvite: (id: string) => void;
  /** Party invites waiting for an answer (ADR 0112) — JOIN accepts, × declines. */
  partyInvites?: PartyInviteView[];
  onJoinPartyInvite?: (invite: PartyInviteView) => void;
  onDeclinePartyInvite?: (invite: PartyInviteView) => void;
  /** Set once the Party host removed you, until dismissed. */
  removal?: PartyRemoval | null;
  onDismissRemoval?: () => void;
}

/**
 * The live friend alerts (M9 ticket 12) — the `FriendRequestAlert` mock's
 * right column, wired: one alert per pending request (answerable in place),
 * one per Lobby invite (JOIN or dismiss), one per Party invite (the same dark
 * invite toast, kicked PARTY INVITE: JOIN or decline, ADR 0112), and the
 * Party mock's toast when the host removed you. Rendered once by
 * `<GlobalAlerts>` above the whole authed subtree, so an invite stays a
 * visible alert on every route until it is answered or the game starts.
 * Renders nothing when there is nothing to answer.
 */
export default function FriendAlerts({
  requests,
  invites,
  onAccept,
  onDecline,
  onJoinInvite,
  onDismissInvite,
  partyInvites = [],
  onJoinPartyInvite,
  onDeclinePartyInvite,
  removal = null,
  onDismissRemoval,
}: FriendAlertsProps) {
  if (requests.length === 0 && invites.length === 0 && partyInvites.length === 0 && removal === null) return null;
  return (
    <div className={s.alerts} aria-live="polite">
      {removal !== null && (
        <div className={s.toast}>
          <Avatar look={removal.look} size={3.1} />
          <span className={s.toastText}>
            <span className={s.toastTitle}>{removal.byName.toUpperCase()} REMOVED YOU FROM THE PARTY</span>
            <span className={s.toastBody}>{"You're on your own again — invite someone or jump into a quick match."}</span>
          </span>
          <button
            type="button"
            className={[s.action, s.decline].join(" ")}
            aria-label="Dismiss"
            onClick={onDismissRemoval}
          >
            <CrossIcon />
          </button>
        </div>
      )}
      {requests.map((request) => (
        <div key={request.id} className={s.toast}>
          <Avatar look={avatarLook(request.fromAccountId, request.fromColor)} size={3.75} />
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
      {partyInvites.map((invite) => (
        <div key={invite.id} className={[s.toast, s.toastDark].join(" ")}>
          <Avatar look={avatarLook(invite.fromAccountId, invite.fromColor, invite.fromAvatarUploadedAt)} size={3.1} />
          <span className={s.toastText}>
            <span className={s.toastKicker}>PARTY INVITE</span>
            <span className={s.toastTitle}>
              {/* Alone, the host is just a bean asking; with company, the strip's own count. */}
              {invite.partySize > 1
                ? `${invite.fromDisplayName.toUpperCase()}'S PARTY · ${invite.partySize}/${PARTY_MAX_SIZE}`
                : `${invite.fromDisplayName.toUpperCase()} INVITED YOU`}
            </span>
          </span>
          <JellyButton variant="pill" centered onClick={() => onJoinPartyInvite?.(invite)}>
            JOIN
          </JellyButton>
          <button
            type="button"
            className={[s.action, s.decline].join(" ")}
            aria-label={`Decline party invite from ${invite.fromDisplayName}`}
            onClick={() => onDeclinePartyInvite?.(invite)}
          >
            <CrossIcon />
          </button>
        </div>
      ))}
      {invites.map((invite) => (
        <div key={invite.id} className={[s.toast, s.toastDark].join(" ")}>
          <Avatar look={avatarLook(invite.fromAccountId, invite.fromColor)} size={3.1} />
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
