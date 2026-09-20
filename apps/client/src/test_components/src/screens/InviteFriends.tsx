import { useMemo, useState } from 'react';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import Avatar from '../ui/Avatar';
import type { Skin } from '../ui/Avatar';
import JellyButton from '../ui/JellyButton';
import type { Feel } from '../tokens';
import s from './InviteFriends.module.css';

export type InviteState = 'free' | 'invited' | 'busy';
export type InviteFilter = 'ONLINE' | 'RECENT' | 'ALL';

export interface InviteCandidate {
  name: string;
  skin: Skin;
  status: string;
  state?: InviteState;
  /** Mid-race but still joinable — worth inviting. */
  inRace?: boolean;
  /** Shown under RECENT / ALL only. */
  offline?: boolean;
}

export interface InviteFriendsProps {
  slotsLeft?: number;
  code?: string;
  candidates?: InviteCandidate[];
  onInvite?: (name: string) => void;
  onCancel?: (name: string) => void;
  onClose?: () => void;
  onShare?: () => void;
  feel?: Feel;
}

const CANDIDATES: InviteCandidate[] = [
  { name: 'BONK', skin: 'pink', status: 'ONLINE · IN MENU' },
  { name: 'WIGGLY', skin: 'grape', status: 'INVITED · WAITING 0:12', state: 'invited' },
  { name: 'SPLAT', skin: 'mint', status: 'IN A RACE · CAN STILL JOIN', inRace: true },
  { name: 'TUMBLES', skin: 'gold', status: 'IN ANOTHER PARTY · 4/4', state: 'busy' },
  { name: 'MRBEANO', skin: 'cyan', status: 'OFFLINE · 2 DAYS AGO', state: 'busy', offline: true },
];

const TABS: InviteFilter[] = ['ONLINE', 'RECENT', 'ALL'];

const SearchIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7" /><path d="M15.8 15.8L21 21" /></svg>;
const CopyIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 5.5H6.5A2.5 2.5 0 004 8v8" /></svg>;
const CrossIcon = () => <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" /></svg>;

/** The card on its own, so a screen can drop it over its own stage as a modal. */
export function InviteCard({
  slotsLeft = 2, code = '4K7NQX', candidates = CANDIDATES,
  onInvite, onCancel, onClose, onShare, feel,
}: InviteFriendsProps) {
  const [tab, setTab] = useState<InviteFilter>('ONLINE');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);

  const online = candidates.filter((c) => !c.offline).length;
  const counts: Record<InviteFilter, number> = { ONLINE: online, RECENT: candidates.length, ALL: 48 };

  const shown = useMemo(() => {
    const q = query.trim().toUpperCase();
    return candidates
      .filter((c) => (tab === 'ONLINE' ? !c.offline : true))
      .filter((c) => (q ? c.name.includes(q) : true));
  }, [candidates, tab, query]);

  const copy = () => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Panel modal className={s.card}>
      <div className={s.head}>
        <div>
          <div className={s.heading}>INVITE FRIENDS</div>
          <span className={s.slotsLeft}>
            {slotsLeft > 0 ? `${slotsLeft} SLOT${slotsLeft > 1 ? 'S' : ''} LEFT IN YOUR PARTY` : 'PARTY IS FULL'}
          </span>
        </div>
        <button type="button" className={s.close} onClick={onClose} aria-label="Close"><CrossIcon /></button>
      </div>

      <div className={s.find}>
        <label className={s.search}>
          <SearchIcon />
          <input
            className={s.field}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search friends or paste a code"
            aria-label="Search friends or paste a code"
          />
        </label>
        <button type="button" className={s.code} onClick={copy}>
          <span className={s.codeLabel}>CODE</span>
          <span className={s.codeValue} data-df-numeric>{code}</span>
          {copied ? <span className={s.copied}>COPIED</span> : <CopyIcon />}
        </button>
      </div>

      <div className={s.tabs} role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === tab}
            onClick={() => setTab(t)}
            className={[s.tab, t === tab && s.tabOn].filter(Boolean).join(' ')}
          >{t} · {counts[t]}</button>
        ))}
      </div>

      <div className={s.list}>
        {shown.map((c) => {
          const state: InviteState = c.state ?? 'free';
          return (
            <div
              key={c.name}
              className={[s.row, state === 'invited' && s.rowInvited, state === 'busy' && s.rowBusy].filter(Boolean).join(' ')}
            >
              <Avatar skin={c.skin} size={3.6} />
              <span className={s.who}>
                <span className={s.name}>{c.name}</span>
                <span className={[
                  s.status,
                  state === 'invited' && s.statusInvited,
                  state === 'busy' && s.statusBusy,
                  c.inRace && s.statusRace,
                ].filter(Boolean).join(' ')}
                >{c.status}</span>
              </span>

              {state === 'busy' ? (
                <span className={s.busyTag}>{c.offline ? 'OFFLINE' : 'BUSY'}</span>
              ) : state === 'invited' ? (
                <JellyButton
                  variant="pill" tone="glass" centered feel={feel}
                  icon={<svg className={s.cancelIcon} viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" /></svg>}
                  onClick={() => onCancel?.(c.name)}
                >CANCEL</JellyButton>
              ) : (
                <JellyButton
                  variant="pill" centered feel={feel}
                  disabled={slotsLeft === 0}
                  onClick={() => onInvite?.(c.name)}
                >INVITE</JellyButton>
              )}
            </div>
          );
        })}

        {shown.length === 0 && <div className={s.empty}>NO BEANS MATCH — TRY THE CODE INSTEAD</div>}
      </div>

      <div className={s.foot}>
        <span className={s.footText}>Nobody online? Share the code — it works for 10 minutes.</span>
        <JellyButton variant="pill" tone="danger" centered feel={feel} onClick={onShare}>SHARE LINK</JellyButton>
      </div>
    </Panel>
  );
}

/** Standalone screen: the card centred on the menu stage behind a scrim. */
export default function InviteFriends(props: InviteFriendsProps) {
  return (
    <Stage
      background="var(--df-stage-menu)"
      sheen="var(--df-color-scrim)"
      feel={props.feel}
      className={s.screen}
    >
      <InviteCard {...props} />
    </Stage>
  );
}
