import { useState } from 'react';
import { FRIEND_CODE_LENGTH } from '@dont-fall/shared';
import { CrossIcon, TickIcon } from '../ui/AnswerIcons';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import Avatar from '../ui/Avatar';
import type { AvatarLook } from '../lib/avatar.js';
import type { Feel } from '../tokens';
import type { FriendsTab } from '../lib/friendsView';
import s from './Friends.module.css';

export interface FriendRequestRow {
  id: string;
  name: string;
  look: AvatarLook;
  /** Why you'd know them — `null` hides the line rather than inventing one. */
  note: string | null;
}

export interface FriendRowView {
  accountId: string;
  name: string;
  look: AvatarLook;
  status: string;
  tab: Exclude<FriendsTab, 'RECENT'>;
  /** Joinable right now. */
  joinable?: boolean;
  /** Mid-match — can't be invited. */
  busy?: boolean;
  offline?: boolean;
}

export interface RecentRowView {
  accountId: string;
  name: string;
  look: AvatarLook;
  note: string;
  /** Already friends, or ADDed this session — the row reads SENT, never ADD again. */
  requested: boolean;
}

export interface FriendsProps {
  online: number;
  total: number;
  requests: FriendRequestRow[];
  friends: FriendRowView[];
  recent: RecentRowView[];
  /** This Account's own add-code — `null` until it loads. */
  ownCode: string | null;
  isLoading: boolean;
  error: string | null;
  onBack?: () => void;
  onInviteAll?: () => void;
  onAccept?: (id: string) => void;
  onDecline?: (id: string) => void;
  onAcceptAll?: () => void;
  onJoin?: (accountId: string) => void;
  onInvite?: (accountId: string) => void;
  onRemove?: (accountId: string) => void;
  onAddByCode?: (code: string) => Promise<void>;
  onAddRecent?: (accountId: string) => void;
  onRetry?: () => void;
  feel?: Feel;
}

const TABS: FriendsTab[] = ['ONLINE', 'IN A MATCH', 'OFFLINE', 'RECENT'];

export default function Friends({
  online, total, requests, friends, recent, ownCode, isLoading, error,
  onBack, onInviteAll, onAccept, onDecline, onAcceptAll, onJoin, onInvite, onRemove,
  onAddByCode, onAddRecent, onRetry, feel,
}: FriendsProps) {
  const [tab, setTab] = useState<FriendsTab>('ONLINE');
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codePending, setCodePending] = useState(false);

  const visible = friends.filter((f) => f.tab === tab);

  const submitCode = () => {
    if (onAddByCode === undefined || codePending) return;
    const trimmed = code.trim();
    if (trimmed.length === 0) {
      setCodeError('TYPE A FRIEND CODE FIRST.');
      return;
    }
    setCodePending(true);
    setCodeError(null);
    void onAddByCode(trimmed).then(
      () => {
        setCode('');
        setCodeOpen(false);
      },
      (err: unknown) => setCodeError(err instanceof Error ? err.message.toUpperCase() : 'THAT DID NOT WORK.'),
    ).finally(() => setCodePending(false));
  };

  return (
    <Stage background="var(--df-stage-lobby)" sheen="var(--df-sheen-menu)" feel={feel} className={s.screen}>
      <div className={s.topbar}>
        <div className={s.crumb}>
          <button type="button" className={s.back} data-ui-sound="back" onClick={onBack} aria-label="Back">
            <svg viewBox="0 0 18 18"><path d="M11 3L5 9l6 6" /></svg>
          </button>
          <span className={s.title}>FRIENDS</span>
          {/* The design's count pill, as a button that does what it says: shows who is online (ADR 0110). */}
          <JellyButton variant="pill" tone="glass" centered onClick={() => setTab('ONLINE')}>{online} ONLINE · {total} TOTAL</JellyButton>
        </div>
        <div className={s.topActions}>
          <JellyButton variant="pill" centered onClick={onInviteAll}>INVITE ALL ONLINE</JellyButton>
          <JellyButton variant="pill" tone="glass" centered onClick={() => setCodeOpen((open) => !open)}>ADD BY CODE</JellyButton>
        </div>
      </div>

      {codeOpen && (
        <Panel className={s.codePanel}>
          <span className={s.codeTitle}>ADD BY CODE</span>
          {ownCode !== null && <span className={s.ownCode}>YOUR CODE: {ownCode}</span>}
          <div className={s.codeRow}>
            <input
              className={s.codeInput}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="BEAN42"
              maxLength={FRIEND_CODE_LENGTH}
              aria-label="Friend code"
              onKeyDown={(e) => { if (e.key === 'Enter') submitCode(); }}
            />
            <JellyButton variant="pill" centered onClick={submitCode} disabled={codePending}>
              {codePending ? 'ADDING…' : 'ADD'}
            </JellyButton>
          </div>
          {codeError !== null && <span className={s.codeError} role="alert">{codeError}</span>}
        </Panel>
      )}

      {isLoading && <p className={s.state}>LOADING FRIENDS…</p>}

      {!isLoading && error !== null && (
        <div className={s.state}>
          <p>{error}</p>
          {onRetry !== undefined && (
            <JellyButton variant="pill" tone="glass" centered onClick={onRetry}>TRY AGAIN</JellyButton>
          )}
        </div>
      )}

      {!isLoading && error === null && (
        <>
          {requests.length > 0 && (
            <Panel className={s.requests}>
              <div className={s.requestHead}>
                <span className={s.requestTitle}>REQUESTS</span>
                <span className={s.count}>{requests.length}</span>
              </div>

              <div className={s.list}>
                {requests.map((r, i) => (
                  <div key={r.id} className={[s.request, i === 0 && s.newest].filter(Boolean).join(' ')}>
                    <Avatar look={r.look} size={3.4} />
                    <span className={s.who}>
                      <span className={s.whoName}>{r.name}</span>
                      {r.note !== null && <span className={s.whoNote}>{r.note}</span>}
                    </span>
                    <button type="button" className={[s.action, s.accept].join(' ')} aria-label={`Accept ${r.name}`} onClick={() => onAccept?.(r.id)}><TickIcon /></button>
                    <button type="button" className={[s.action, s.decline].join(' ')} aria-label={`Decline ${r.name}`} onClick={() => onDecline?.(r.id)}><CrossIcon /></button>
                  </div>
                ))}
              </div>

              <button type="button" className={s.acceptAll} onClick={onAcceptAll}>ACCEPT ALL</button>
            </Panel>
          )}

          <div className={s.roster}>
            <div className={s.tabs} role="tablist">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={t === tab}
                  onClick={() => setTab(t)}
                  className={[s.tab, t === tab && s.tabOn].filter(Boolean).join(' ')}
                >{t}</button>
              ))}
            </div>

            {tab !== 'RECENT' && (
              <div className={s.friends}>
                {visible.length === 0 && <p className={s.empty}>NOBODY HERE YET.</p>}
                {visible.map((f) => (
                  <div key={f.accountId} className={[s.friend, f.offline && s.dim].filter(Boolean).join(' ')}>
                    <Avatar
                      look={f.look}
                      size={3.6}
                      ring={f.joinable ? 'var(--df-color-go)' : undefined}
                    />
                    <span className={s.friendText}>
                      <span className={s.friendName}>{f.name}</span>
                      <span className={[s.friendStatus, f.busy && s.statusBusy, f.offline && s.statusIdle].filter(Boolean).join(' ')}>
                        {f.status}
                      </span>
                    </span>
                    {f.joinable ? (
                      <JellyButton variant="pill" tone="go" centered onClick={() => onJoin?.(f.accountId)}>JOIN</JellyButton>
                    ) : (
                      <JellyButton variant="pill" tone="glass" centered disabled={f.offline || f.busy} onClick={() => onInvite?.(f.accountId)}>INVITE</JellyButton>
                    )}
                    <button type="button" className={s.remove} aria-label={`Remove ${f.name}`} onClick={() => onRemove?.(f.accountId)}>
                      <CrossIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {tab === 'RECENT' && (
              <div className={s.friends}>
                {recent.length === 0 && <p className={s.empty}>FINISH A MATCH TO MEET BEANS.</p>}
                {recent.map((r) => (
                  <div key={r.accountId} className={s.friend}>
                    <Avatar look={r.look} size={3.6} />
                    <span className={s.friendText}>
                      <span className={s.friendName}>{r.name}</span>
                      <span className={s.friendStatus}>{r.note}</span>
                    </span>
                    <JellyButton
                      variant="pill"
                      tone={r.requested ? 'glass' : 'go'}
                      centered
                      disabled={r.requested}
                      onClick={() => onAddRecent?.(r.accountId)}
                    >{r.requested ? 'SENT' : 'ADD'}</JellyButton>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Stage>
  );
}
