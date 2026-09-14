import { useState } from 'react';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import Avatar from '../ui/Avatar';
import type { Skin } from '../ui/Avatar';
import type { Feel } from '../tokens';
import s from './Friends.module.css';

export type FriendFilter = 'ONLINE' | 'IN A MATCH' | 'OFFLINE' | 'RECENT';

export interface FriendRequest {
  name: string;
  skin: Skin;
  /** Why you'd know them. */
  note: string;
}

export interface Friend {
  name: string;
  skin: Skin;
  status: string;
  /** Joinable right now. */
  joinable?: boolean;
  /** Mid-match — can't be invited. */
  busy?: boolean;
  offline?: boolean;
}

export interface FriendsProps {
  online?: number;
  total?: number;
  requests?: FriendRequest[];
  friends?: Friend[];
  onBack?: () => void;
  onInviteAll?: () => void;
  feel?: Feel;
}

const REQUESTS: FriendRequest[] = [
  { name: 'GOOPY', skin: 'mint', note: 'PLAYED 4 MATCHES TOGETHER' },
  { name: 'SPLATTO', skin: 'gold', note: 'GRABBED YOU 9 TIMES' },
  { name: 'BONK', skin: 'pink', note: 'FROM YOUR LAST LOBBY' },
];

const FRIENDS: Friend[] = [
  { name: 'FLOPPO', skin: 'cyan', status: 'IN LOBBY · 3 SLOTS OPEN', joinable: true },
  { name: 'WOBBLETON', skin: 'mint', status: 'IN A MATCH · ROUND 2', busy: true },
  { name: 'MRBEANO', skin: 'grape', status: 'IN THE MENU' },
  { name: 'TUMBLEWEED', skin: 'gold', status: 'OFFLINE · 2 DAYS AGO', offline: true },
];

const TABS: FriendFilter[] = ['ONLINE', 'IN A MATCH', 'OFFLINE', 'RECENT'];

const TickIcon = () => <svg viewBox="0 0 16 13" aria-hidden="true"><path d="M1.5 6.5l4.5 4.5L14.5 2" /></svg>;
const CrossIcon = () => <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" /></svg>;

export default function Friends({
  online = 12, total = 48, requests = REQUESTS, friends = FRIENDS, onBack, onInviteAll, feel,
}: FriendsProps) {
  const [tab, setTab] = useState<FriendFilter>('ONLINE');

  return (
    <Stage background="var(--df-stage-lobby)" sheen="var(--df-sheen-menu)" feel={feel} className={s.screen}>
      <div className={s.topbar}>
        <div className={s.crumb}>
          <button type="button" className={s.back} onClick={onBack} aria-label="Back">
            <svg viewBox="0 0 18 18"><path d="M11 3L5 9l6 6" /></svg>
          </button>
          <span className={s.title}>FRIENDS</span>
          <JellyButton variant="pill" tone="glass" centered feel={feel}>{online} ONLINE · {total} TOTAL</JellyButton>
        </div>
        <div className={s.topActions}>
          <JellyButton variant="pill" centered feel={feel} onClick={onInviteAll}>INVITE ALL ONLINE</JellyButton>
          <JellyButton variant="pill" tone="glass" centered feel={feel}>ADD BY CODE</JellyButton>
        </div>
      </div>

      <Panel className={s.requests}>
        <div className={s.requestHead}>
          <span className={s.requestTitle}>REQUESTS</span>
          <span className={s.count}>{requests.length}</span>
        </div>

        <div className={s.list}>
          {requests.map((r, i) => (
            <div key={r.name} className={[s.request, i === 0 && s.newest].filter(Boolean).join(' ')}>
              <Avatar skin={r.skin} size={3.4} />
              <span className={s.who}>
                <span className={s.whoName}>{r.name}</span>
                <span className={s.whoNote}>{r.note}</span>
              </span>
              <button type="button" className={[s.action, s.accept].join(' ')} aria-label={`Accept ${r.name}`}><TickIcon /></button>
              <button type="button" className={[s.action, s.decline].join(' ')} aria-label={`Decline ${r.name}`}><CrossIcon /></button>
            </div>
          ))}
        </div>

        <button type="button" className={s.acceptAll}>ACCEPT ALL</button>
      </Panel>

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

        <div className={s.friends}>
          {friends.map((f) => (
            <div key={f.name} className={[s.friend, f.offline && s.dim].filter(Boolean).join(' ')}>
              <Avatar
                skin={f.skin}
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
                <JellyButton variant="pill" tone="go" centered feel={feel}>JOIN</JellyButton>
              ) : (
                <JellyButton variant="pill" tone="glass" centered feel={feel} disabled={f.offline || f.busy}>INVITE</JellyButton>
              )}
            </div>
          ))}
        </div>
      </div>
    </Stage>
  );
}
