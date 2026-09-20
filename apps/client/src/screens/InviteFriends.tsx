import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PARTY_CODE_TTL_MS } from '@dont-fall/shared';
import Panel from '../ui/Panel';
import Avatar from '../ui/Avatar';
import JellyButton from '../ui/JellyButton';
import { ApiError } from '../lib/api/base.js';
import {
  cancelPartyInvite,
  getPartyCandidates,
  inviteToParty,
  inviteToPartyByCode,
  joinPartyByCode,
  lookupPartyCode,
} from '../lib/api/party.js';
import { copyText } from '../lib/clipboard.js';
import { flash } from '../lib/flash.js';
import { useNow } from '../lib/hooks/useNow.js';
import { useParty } from '../lib/social/accountSocket.js';
import { partyShareUrl } from '../lib/social/partyLink.js';
import {
  codeInQuery,
  foundRow,
  INVITE_TABS,
  inviteTabs,
  joinedPartyMessage,
  matchingRows,
  slotsLeft as slotsLeftOf,
  type FoundRow,
  type InviteRow,
  type InviteTab,
} from '../lib/social/partyView.js';
import s from './InviteFriends.module.css';

/** How long the code chip says COPIED — the mock's own beat. */
const COPIED_SHOWN_MS = 1_600;
/** How often a row's INVITED · WAITING m:ss counts. */
const WAIT_CLOCK_MS = 1_000;
/** The Party code's lifetime, in the footer's words. */
const CODE_MINUTES = Math.round(PARTY_CODE_TTL_MS / 60_000);

export interface InviteCardProps {
  /** Invites the Party can still send: its cap less seated beans and invites out. */
  slotsLeft: number;
  /** The Party code — `null` when there is none to share (a full Party). */
  code: string | null;
  rows: Record<InviteTab, InviteRow[]>;
  counts: Record<InviteTab, number>;
  query: string;
  onQuery: (query: string) => void;
  /** What a code typed into the search turned out to be — shown above the rows. */
  found?: FoundRow | null | undefined;
  onInvite: (row: InviteRow) => void;
  onCancel: (row: InviteRow) => void;
  /** JOIN on a Party found by its code. */
  onJoin: (code: string) => void;
  /** Copies the code, answering whether it went — the chip says COPIED only when it did. */
  onCopyCode: () => Promise<boolean>;
  onShare: () => void;
  onClose: () => void;
}

const SearchIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7" /><path d="M15.8 15.8L21 21" /></svg>;
const CopyIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 5.5H6.5A2.5 2.5 0 004 8v8" /></svg>;
const CrossIcon = () => <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" /></svg>;

/**
 * The INVITE FRIENDS card (ADR 0112) — the `InviteFriends` mock's
 * `InviteCard`, ported as drawn: the search (which also takes a pasted
 * code), the Party code chip, ONLINE / RECENT / ALL, one row per bean, and
 * SHARE LINK. Presentational — its rows are the API's, put into words by
 * `partyView.ts`; `<InviteFriends>` below feeds it.
 */
export function InviteCard({
  slotsLeft, code, rows, counts, query, onQuery, found = null,
  onInvite, onCancel, onJoin, onCopyCode, onShare, onClose,
}: InviteCardProps) {
  const [tab, setTab] = useState<InviteTab>('ONLINE');
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
  }, []);

  // A bean the code found is shown once, as the found row — not again below it.
  const foundId = found?.kind === 'bean' ? found.row.accountId : null;
  const shown = useMemo(
    () => matchingRows(rows[tab], query).filter((row) => row.accountId !== foundId),
    [rows, tab, query, foundId],
  );

  const copy = () => {
    void onCopyCode().then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_SHOWN_MS);
    });
  };

  const renderRow = (c: InviteRow) => {
    const state = c.state;
    return (
      <div
        key={c.accountId}
        role="listitem"
        aria-label={c.name}
        className={[s.row, state === 'invited' && s.rowInvited, state === 'busy' && s.rowBusy].filter(Boolean).join(' ')}
      >
        <Avatar look={c.look} size={3.6} />
        <span className={s.who}>
          <span className={s.name}>{c.name}</span>
          <span className={[
            s.status,
            state === 'invited' && s.statusInvited,
            state === 'busy' && s.statusBusy,
            c.inMatch && s.statusRace,
          ].filter(Boolean).join(' ')}
          >{c.status}</span>
        </span>

        {state === 'busy' ? (
          <span className={s.busyTag}>{c.offline ? 'OFFLINE' : 'BUSY'}</span>
        ) : state === 'invited' ? (
          <JellyButton
            variant="pill" tone="glass" centered
            icon={<svg className={s.cancelIcon} viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" /></svg>}
            onClick={() => onCancel(c)}
          >CANCEL</JellyButton>
        ) : (
          <JellyButton
            variant="pill" centered
            disabled={slotsLeft === 0}
            onClick={() => onInvite(c)}
          >INVITE</JellyButton>
        )}
      </div>
    );
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
        <button type="button" className={s.close} data-ui-sound="back" onClick={onClose} aria-label="Close"><CrossIcon /></button>
      </div>

      <div className={s.find}>
        <label className={s.search}>
          <SearchIcon />
          <input
            className={s.field}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search friends or paste a code"
            aria-label="Search friends or paste a code"
          />
        </label>
        {code !== null && (
          <button type="button" className={s.code} onClick={copy} aria-label={`Copy the party code ${code}`}>
            <span className={s.codeLabel}>CODE</span>
            <span className={s.codeValue} data-df-numeric>{code}</span>
            {copied ? <span className={s.copied}>COPIED</span> : <CopyIcon />}
          </button>
        )}
      </div>

      <div className={s.tabs} role="tablist">
        {INVITE_TABS.map((t) => (
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

      <div className={s.list} role="list">
        {found?.kind === 'party' && (
          <div role="listitem" aria-label={found.status} className={s.row}>
            <Avatar look={found.look} size={3.6} />
            <span className={s.who}>
              <span className={s.name}>{found.name}</span>
              <span className={s.status}>{found.status}</span>
            </span>
            <JellyButton variant="pill" centered disabled={found.full} onClick={() => onJoin(found.code)}>JOIN</JellyButton>
          </div>
        )}
        {found?.kind === 'bean' && renderRow(found.row)}

        {shown.map(renderRow)}

        {shown.length === 0 && found === null && <div className={s.empty}>NO BEANS MATCH — TRY THE CODE INSTEAD</div>}
      </div>

      <div className={s.foot}>
        <span className={s.footText}>Nobody online? Share the code — it works for {CODE_MINUTES} minutes.</span>
        <JellyButton variant="pill" tone="danger" centered disabled={code === null} onClick={onShare}>SHARE LINK</JellyButton>
      </div>
    </Panel>
  );
}

const messageOf = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);

/**
 * The INVITE FRIENDS card over the main menu, wired (ADR 0112): its rows
 * from `GET /party/candidates` — asked again whenever the Party changes,
 * since every row's state is the Party's — a pasted code looked up
 * (`GET /party/lookup/:code`), and every button one `/party` route. What
 * each does to the Party arrives over the Account socket like any other
 * change; a refusal is flashed in the API's own words.
 */
export default function InviteFriends({ onClose }: { onClose: () => void }) {
  const party = useParty();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const lookupCode = codeInQuery(query);

  const candidates = useQuery({ queryKey: ['party', 'candidates'], queryFn: getPartyCandidates });
  // A six-letter name looks like a code too: a 404 is just "not a code", never an error to show.
  const lookup = useQuery({
    queryKey: ['party', 'lookup', lookupCode],
    queryFn: () => lookupPartyCode(lookupCode!),
    enabled: lookupCode !== null,
  });

  const counting = party.pending.length > 0;
  const now = useNow(WAIT_CLOCK_MS, counting);

  // Every row's state is the Party's — an invite answered, a bean joining —
  // so the rows are asked for again on each change the socket brings.
  const partySeen = useRef(party.party);
  useEffect(() => {
    if (partySeen.current === party.party) return;
    partySeen.current = party.party;
    void queryClient.invalidateQueries({ queryKey: ['party'] });
  }, [party.party, queryClient]);

  useEffect(() => {
    if (candidates.error) flash(messageOf(candidates.error, 'Could not load your friends.'), 'error');
  }, [candidates.error]);

  const list = candidates.data?.candidates ?? [];
  const { rows, counts } = inviteTabs(list, candidates.data?.friendCount ?? 0, party, now);
  const found = lookupCode !== null && lookup.data ? foundRow(lookup.data, lookupCode, list, party, now) : null;
  const code = party.party?.code ?? null;

  // One request per bean at a time: a double tap must not answer "already invited".
  const inFlight = useRef(new Set<string>());
  const act = (key: string, request: () => Promise<unknown>, fallback: string, quietStatus?: number): void => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    request()
      .then(
        () => undefined,
        (err: unknown) => {
          if (!(quietStatus !== undefined && err instanceof ApiError && err.status === quietStatus)) flash(messageOf(err, fallback), 'error');
        },
      )
      .finally(() => {
        inFlight.current.delete(key);
        void queryClient.invalidateQueries({ queryKey: ['party'] });
      });
  };

  return (
    <InviteCard
      slotsLeft={slotsLeftOf(party)}
      code={code}
      rows={rows}
      counts={counts}
      query={query}
      onQuery={setQuery}
      found={found}
      onInvite={(row) =>
        act(
          row.accountId,
          () => (row.friendCode === undefined ? inviteToParty(row.accountId) : inviteToPartyByCode(row.friendCode)),
          `Could not invite ${row.name}.`,
        )
      }
      onCancel={(row) => {
        const inviteId = row.inviteId;
        if (inviteId === null) return;
        // Already gone (answered, expired) is what cancelling wanted anyway.
        act(row.accountId, () => cancelPartyInvite(inviteId), 'Could not cancel that invite.', 404);
      }}
      onJoin={(partyCode) => {
        if (inFlight.current.has(partyCode)) return;
        inFlight.current.add(partyCode);
        joinPartyByCode(partyCode).then(
          (joined) => {
            flash(joinedPartyMessage(joined));
            onClose();
          },
          (err: unknown) => {
            inFlight.current.delete(partyCode);
            flash(messageOf(err, 'Could not join that party.'), 'error');
          },
        );
      }}
      onCopyCode={() => (code === null ? Promise.resolve(false) : copyText(code, null, "Couldn't copy the code."))}
      onShare={() => {
        if (code !== null) void copyText(partyShareUrl(code), 'Party link copied.', "Couldn't copy the link.");
      }}
      onClose={onClose}
    />
  );
}
