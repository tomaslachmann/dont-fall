import { useState } from 'react';
import Stage from '../ui/Stage';
import JellyButton from '../ui/JellyButton';
import Chip from '../ui/Chip';
import type { ChipTone } from '../ui/Chip';
import type { Feel } from '../tokens';
import s from './Discover.module.css';

export interface Track {
  name: string;
  author: string;
  mode: string;
  modeTone: ChipTone;
  /** Thumbnail stripe pair — stands in for the real track art. */
  thumb: [string, string];
  rating: string;
  figure: string;
}

export type DiscoverFilter = 'TRENDING' | 'SURVIVAL' | 'RACE' | 'NEW';

const FILTERS: DiscoverFilter[] = ['TRENDING', 'SURVIVAL', 'RACE', 'NEW'];

const TRACKS: Track[] = [
  { name: 'JELLY GAUNTLET', author: 'BY WOBBLEKING', mode: 'SURVIVAL', modeTone: 'survival', thumb: ['#FFC9E4', '#FFB4DC'], rating: '★ 4.8K', figure: '12K PLAYS' },
  { name: 'SLIP CITY LOOP', author: 'BY MRBEANO', mode: 'RACE', modeTone: 'race', thumb: ['#BFE9FF', '#9CDCFF'], rating: '★ 3.1K', figure: 'BEST 00:48.2' },
  { name: 'TUMBLE PARK', author: 'BY GOOPY', mode: 'CHAOS', modeTone: 'ready', thumb: ['#CFF7C9', '#B6F0AE'], rating: '★ 900', figure: 'NEW' },
  { name: 'THE BIG WOBBLE', author: 'BY SPLATTO', mode: 'HARD', modeTone: 'closing', thumb: ['#FFE3B0', '#FFD08F'], rating: '★ 7.2K', figure: '2% CLEAR' },
];

export interface DiscoverProps {
  tracks?: Track[];
  onBack?: () => void;
  onTry?: () => void;
  feel?: Feel;
}

const stripe = ([a, b]: [string, string]) =>
  `repeating-linear-gradient(115deg,${a} 0 calc(var(--df-u) * .95),${b} calc(var(--df-u) * .95) calc(var(--df-u) * 1.9))`;

export default function Discover({ tracks = TRACKS, onBack, onTry, feel }: DiscoverProps) {
  const [filter, setFilter] = useState<DiscoverFilter>('TRENDING');

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
              feel={feel}
              onClick={() => setFilter(f)}
            >{f}</JellyButton>
          ))}
        </div>
      </div>

      <div className={s.grid}>
        {tracks.map((t) => (
          <button key={t.name} type="button" className={s.card}>
            <span className={s.thumb} style={{ background: stripe(t.thumb) }}>
              <span className={s.thumbCaption}>EXISTING<br />TRACK THUMBNAIL</span>
              <span className={s.thumbTag}><Chip tone={t.modeTone}>{t.mode}</Chip></span>
            </span>
            <span className={s.meta}>
              <span className={s.name}>{t.name}</span>
              <span className={s.author}>{t.author}</span>
              <span className={s.figures}>
                <span>{t.rating}</span>
                <span className={s.dim}>{t.figure}</span>
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className={s.featured}>
        <span className={s.featuredText}>
          <span className={s.featuredKicker}>TODAY’S FEATURED CHAOS</span>
          <span className={s.featuredTitle}>NOBODY HAS FINISHED THIS ONE YET</span>
        </span>
        <JellyButton variant="tile" centered feel={feel} onClick={onTry}>TRY IT</JellyButton>
      </div>
    </Stage>
  );
}
