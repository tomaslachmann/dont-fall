import type { CSSProperties } from 'react';
import Avatar from './Avatar';
import JellyButton from './JellyButton';
import type { AvatarLook } from '../lib/avatar.js';
import s from './PartyStrip.module.css';

export interface PartyMember {
  /** Whose bean — the slot's key, and what its × is called with. */
  accountId: string;
  name: string;
  /** Their avatar (ADR 0110): picture over the disc in their bean's Colour. */
  look: AvatarLook;
  level?: number | undefined;
  /** The local player. */
  you?: boolean | undefined;
  /** Owns the party — can invite and kick. */
  host?: boolean | undefined;
  /** Invite sent, not answered yet. Shows a clock and a cancel × instead of a kick ×. */
  pending?: boolean | undefined;
  /** Time the invite has been out, e.g. '0:42'. */
  waiting?: string | undefined;
  /** Not in the menus — what they are doing instead (IN A MATCH), said in place of READY. */
  away?: string | undefined;
}

export interface PartyStripProps {
  members?: PartyMember[] | undefined;
  /** Hard cap — the game only ever parties four. */
  capacity?: number | undefined;
  /** Local player owns the party: kick ×, invite slot, party code. */
  isHost?: boolean | undefined;
  title?: string | undefined;
  /** One short line next to the count, e.g. what the host can do. */
  note?: string | undefined;
  code?: string | undefined;
  /** Tapping the code copies it — without one the code is only shown. */
  onCopyCode?: (() => void) | undefined;
  onlineCount?: number | undefined;
  onInvite?: (() => void) | undefined;
  /** Called with the bean's account id — a seated one is removed, a pending one un-invited. Kicking is immediate — no confirm dialog. */
  onKick?: ((accountId: string) => void) | undefined;
  onLeave?: (() => void) | undefined;
  /** Nothing to leave: a party of one with no invites out. */
  leaveDisabled?: boolean | undefined;
  className?: string | undefined;
}

const Crown = () => (
  <svg className={s.crown} viewBox="0 0 14 12" aria-hidden="true"><path d="M0 11h14L12 2 9.5 5.5 7 0 4.5 5.5 2 2z" /></svg>
);
const Cross = () => (
  <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" /></svg>
);
const Plus = () => (
  <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 3v12M3 9h12" /></svg>
);
const Clock = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></svg>
);

export default function PartyStrip({
  members = [], capacity = 4, isHost = true, title = 'YOUR PARTY', note,
  code, onCopyCode, onlineCount = 0, onInvite, onKick, onLeave, leaveDisabled, className,
}: PartyStripProps) {
  const seated = members.slice(0, capacity);
  const free = Math.max(0, capacity - seated.length);
  const full = free === 0;
  const invited = seated.filter((m) => m.pending).length;

  const codeChip = (
    <>
      <span className={s.codeLabel}>CODE</span>
      <span className={s.codeValue} data-df-numeric>{code}</span>
    </>
  );

  const countLabel = invited > 0
    ? `${seated.length - invited}/${capacity} · ${invited} INVITED`
    : full ? `${capacity}/${capacity} · FULL` : `${seated.length}/${capacity}`;

  return (
    <div
      className={[s.strip, className].filter(Boolean).join(' ')}
      style={{ '--df-party-cap': capacity } as CSSProperties}
    >
      <div className={s.head}>
        <span className={s.title}>{title}</span>
        <span className={[s.count, full && s.countFull].filter(Boolean).join(' ')}>{countLabel}</span>
        {note && <span className={s.note}>{note}</span>}
        <span className={s.spacer} />
        {isHost && code && !full && (onCopyCode ? (
          <button type="button" className={s.code} onClick={onCopyCode} aria-label={`Copy the party code ${code}`}>{codeChip}</button>
        ) : (
          <span className={s.code}>{codeChip}</span>
        ))}
        {isHost && free > 0
          ? <JellyButton variant="pill" centered onClick={onInvite}>INVITE FRIENDS</JellyButton>
          : null}
        <JellyButton variant="pill" tone="glass" centered disabled={leaveDisabled} onClick={onLeave}>LEAVE PARTY</JellyButton>
      </div>

      <div className={s.slots}>
        {seated.map((m) => (
          <div
            key={m.accountId}
            className={[
              s.slot,
              m.pending && s.pending,
              m.host && s.host,
              m.you && !m.host && s.self,
            ].filter(Boolean).join(' ')}
          >
            {m.pending
              ? <span className={s.clock}><Clock /></span>
              : <Avatar look={m.look} size={3.75} />}

            <span className={s.who}>
              <span className={s.name}>{m.name}</span>
              <span className={[
                s.status,
                m.host && s.statusHost,
                // A bean the party is waiting on wears the invite's waiting colour, not READY's.
                (m.pending || (m.away && !m.host)) && s.statusPending,
              ].filter(Boolean).join(' ')}
              >
                {m.host && <Crown />}
                {m.pending
                  ? `INVITED${m.waiting ? ` · ${m.waiting}` : ''}`
                  : m.host
                    ? (m.you ? 'HOST · YOU' : m.away ? `HOST · ${m.away}` : 'HOST')
                    : m.away && !m.you
                      ? m.away
                      : `${m.you ? 'YOU' : 'READY'}${m.level ? ` · LVL ${m.level}` : ''}`}
              </span>
            </span>

            {isHost && !m.you && (
              <button
                type="button"
                className={[s.kick, m.pending && s.cancel].filter(Boolean).join(' ')}
                onClick={() => onKick?.(m.accountId)}
                aria-label={m.pending ? `Cancel invite to ${m.name}` : `Remove ${m.name} from the party`}
              ><Cross /></button>
            )}
          </div>
        ))}

        {Array.from({ length: free }, (_, i) => (
          isHost && i === 0 ? (
            <button key="invite" type="button" className={[s.slot, s.invite].join(' ')} onClick={onInvite}>
              <span className={s.plus}><Plus /></span>
              <span className={s.who}>
                <span className={s.inviteLabel}>INVITE FRIEND</span>
                <span className={s.inviteSub}>{onlineCount} ONLINE</span>
              </span>
            </button>
          ) : (
            <div key={`empty-${i}`} className={[s.slot, s.empty].join(' ')}>
              <span className={s.ghost} />
              <span className={s.emptyLabel}>{isHost ? 'EMPTY SLOT' : <>WAITING<br />FOR HOST</>}</span>
            </div>
          )
        ))}
      </div>
    </div>
  );
}
