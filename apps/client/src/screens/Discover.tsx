import { useState } from 'react';
import type { TrackListing } from '@dont-fall/shared';
import Stage from '../ui/Stage';
import JellyButton from '../ui/JellyButton';
import Chip from '../ui/Chip';
import type { Feel } from '../tokens';
import s from './Discover.module.css';

export type DiscoverFilter = 'TRENDING' | 'SURVIVAL' | 'RACE' | 'NEW';

const FILTERS: DiscoverFilter[] = ['TRENDING', 'SURVIVAL', 'RACE', 'NEW'];

/** A Track counts as NEW while it is less than a week old. */
const NEW_TRACK_MS = 7 * 24 * 60 * 60 * 1000;

export const isNewTrack = (createdAt: number, nowMs: number = Date.now()): boolean =>
  nowMs - createdAt < NEW_TRACK_MS;

/** Compact play counts — single digits stay bare, thousands take a K (the mock's "12K PLAYS"). */
export const formatPlays = (plays: number): string =>
  plays < 1000 ? String(plays) : `${(plays / 1000).toFixed(1).replace(/\.0$/, '')}K`;

/**
 * One tab's view of the catalogue (M9 ticket 16) — pure, so the tabs' own
 * contract is pinned without rendering:
 *
 * - TRENDING ranks the whole catalogue by heat (plays desc, newest first on
 *   ties).
 * - SURVIVAL is the whole catalogue A–Z: every Track supports Survival
 *   (the round draw's own rule), so this tab is the browseable full list,
 *   not a second TRENDING. Unnamed Tracks sort last.
 * - RACE keeps only raceable Tracks (no Finish Zone, no Race), hottest
 *   first — a host picking for a Race can never pick wrong here.
 * - NEW ranks the whole catalogue by recency.
 */
export const filterDiscoverTracks = (tracks: TrackListing[], filter: DiscoverFilter): TrackListing[] => {
  const byHeat = (a: TrackListing, b: TrackListing): number =>
    b.plays - a.plays || b.createdAt - a.createdAt;
  switch (filter) {
    case 'TRENDING':
      return [...tracks].sort(byHeat);
    case 'NEW':
      return [...tracks].sort((a, b) => b.createdAt - a.createdAt);
    case 'RACE':
      return tracks.filter((t) => t.hasFinishZone).sort(byHeat);
    case 'SURVIVAL':
      return [...tracks].sort(
        (a, b) =>
          (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) ||
          (a.name ?? '').localeCompare(b.name ?? '') ||
          b.createdAt - a.createdAt,
      );
  }
};

/** The featured band plays the catalogue's hottest Track (ties go to the newest). */
export const featuredTrack = (tracks: TrackListing[]): TrackListing | null =>
  tracks.length === 0 ? null : filterDiscoverTracks(tracks, 'TRENDING')[0] ?? null;

export interface DiscoverProps {
  /** The catalogue as the API listed it — filtering and sorting happen here, per tab. */
  tracks: TrackListing[];
  isLoading: boolean;
  error: string | null;
  onRetry?: () => void;
  /**
   * Pick mode (the Lobby's inline browser): the currently loaded Track,
   * badged CURRENT. Unset in browse mode (the standalone route), where no
   * Track is "current."
   */
  selectedId?: string;
  /** Card click — and the featured band's TRY IT. Pick mode selects into the Lobby, browse mode practices. */
  onSelect: (trackId: string) => void;
  onBack?: () => void;
  feel?: Feel;
}

/** Thumbnail stripes carry raceability (the Lobby's own thumb pairs, same meanings). */
const THUMBS: Record<'race' | 'survival', [string, string]> = {
  race: ['#BFE9FF', '#9CDCFF'],
  survival: ['#FFC9E4', '#FFB4DC'],
};

const stripe = ([a, b]: [string, string]) =>
  `repeating-linear-gradient(115deg,${a} 0 calc(var(--df-u) * .95),${b} calc(var(--df-u) * .95) calc(var(--df-u) * 1.9))`;

/**
 * Discover (M9 ticket 16) — the Track catalogue with category tabs. A
 * lighter cut of the mock by decision (ADR 0052): browsing + filters only,
 * no ratings, no author display, no best time. Two residents share it: the
 * standalone `/discover` route (browse mode — a card boots Practice on
 * that Track) and the Lobby's inline browser (pick mode — a card selects
 * into Round 1 over the Lobby's own live connection, which is why the
 * Lobby renders this in place instead of navigating away and dropping its
 * socket).
 */
export default function Discover({ tracks, isLoading, error, onRetry, selectedId, onSelect, onBack, feel }: DiscoverProps) {
  const [filter, setFilter] = useState<DiscoverFilter>('TRENDING');
  const visible = error === null && !isLoading ? filterDiscoverTracks(tracks, filter) : [];
  const featured = error === null && !isLoading ? featuredTrack(tracks) : null;

  return (
    <Stage background="var(--df-stage-lobby)" feel={feel} className={s.screen}>
      <div className={s.topbar}>
        <div className={s.crumb}>
          <button type="button" className={s.back} onClick={onBack} aria-label="Back">
            <svg viewBox="0 0 18 18"><path d="M11 3L5 9l6 6" /></svg>
          </button>
          <span className={s.title}>DISCOVER</span>
        </div>
        <div className={s.filters}>
          {FILTERS.map((f) => (
            <JellyButton
              key={f}
              variant="pill"
              tone={f === filter ? 'accent' : 'glass'}
              centered
              onClick={() => setFilter(f)}
            >{f}</JellyButton>
          ))}
        </div>
      </div>

      {isLoading && <p className={s.state}>LOADING TRACKS…</p>}

      {!isLoading && error !== null && (
        <div className={s.state}>
          <p>{error}</p>
          {onRetry !== undefined && (
            <JellyButton variant="pill" tone="glass" centered onClick={onRetry}>TRY AGAIN</JellyButton>
          )}
        </div>
      )}

      {!isLoading && error === null && tracks.length === 0 && (
        <p className={s.state}>NO TRACKS YET — PUBLISH ONE FROM THE TRACK BUILDER.</p>
      )}

      {!isLoading && error === null && tracks.length > 0 && visible.length === 0 && (
        <p className={s.state}>NOTHING RACEABLE YET — A RACE NEEDS A FINISH ZONE.</p>
      )}

      {visible.length > 0 && (
        <div className={s.grid}>
          {visible.map((t) => {
            const selected = t.id === selectedId;
            const name = t.name ?? 'UNTITLED TRACK';
            return (
              <button
                key={t.id}
                type="button"
                className={[s.card, selected && s.cardSelected].filter(Boolean).join(' ')}
                onClick={() => onSelect(t.id)}
                aria-label={`${name}, ${formatPlays(t.plays)} ${t.plays === 1 ? 'play' : 'plays'}, ${t.hasFinishZone ? 'race' : 'survival'}`}
              >
                <span className={s.thumb} style={{ background: stripe(THUMBS[t.hasFinishZone ? 'race' : 'survival']) }}>
                  <span className={s.thumbCaption}>EXISTING<br />TRACK THUMBNAIL</span>
                  <span className={s.thumbTag}>
                    <Chip tone={t.hasFinishZone ? 'race' : 'survival'}>{t.hasFinishZone ? 'RACE' : 'SURVIVAL'}</Chip>
                    {selected && <Chip tone="plate">CURRENT</Chip>}
                  </span>
                </span>
                <span className={s.meta}>
                  <span className={s.name}>{name}</span>
                  <span className={s.figures}>
                    <span>{formatPlays(t.plays)} {t.plays === 1 ? 'PLAY' : 'PLAYS'}</span>
                    {isNewTrack(t.createdAt) && <span className={s.new}>NEW</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {featured !== null && (
        <div className={s.featured}>
          <span className={s.featuredText}>
            <span className={s.featuredKicker}>TODAY’S FEATURED CHAOS</span>
            <span className={s.featuredTitle}>{featured.name ?? 'UNTITLED TRACK'}</span>
          </span>
          <JellyButton variant="tile" centered onClick={() => onSelect(featured.id)}>TRY IT</JellyButton>
        </div>
      )}
    </Stage>
  );
}
