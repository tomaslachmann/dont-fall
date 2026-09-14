import Stage from '../ui/Stage';
import Avatar from '../ui/Avatar';
import type { Skin } from '../ui/Avatar';
import Chip from '../ui/Chip';
import { Pips } from '../ui/Meter';
import s from './Countdown.module.css';

export interface CountdownProps {
  gridSpot?: number;
  field?: number;
  checkpoints?: number;
  /** Null while no persisted best exists — the line hides instead of mocking one. */
  personalBest?: string | null;
  round?: number;
  rounds?: number;
  track?: string;
  mode?: string;
  /** Beans visible on the start line; the rest roll up into a +N bubble. */
  onTheLine?: Skin[];
  othersOnTheLine?: number;
  /**
   * ms left on the server's synchronous Countdown (M4 ticket 04, ADR 0040).
   * The overlay renders what the server decides — the active beat below is
   * derived from this alone, never from a local clock, so it can't drift
   * from the Round's real start.
   */
  countdownMsLeft: number;
}

/** One beat per second: 3, 2, 1, GO!. */
const BEATS = ['3', '2', '1', 'GO!'] as const;

/** Which beat the server's remaining ms means — clamped, so a late or early snapshot still shows a beat. */
const beatIndexFor = (countdownMsLeft: number): number =>
  Math.min(BEATS.length - 1, Math.max(0, BEATS.length - 1 - Math.ceil(countdownMsLeft / 1000)));

export default function Countdown({
  gridSpot = 8, field = 16, checkpoints = 7, personalBest = null,
  round = 3, rounds = 3, track = 'THE BIG WOBBLE', mode = 'RACE',
  onTheLine = ['pink', 'cyan', 'mint', 'gold', 'grape'], othersOnTheLine = 11,
  countdownMsLeft,
}: CountdownProps) {
  const beatIndex = beatIndexFor(countdownMsLeft);
  const beat = BEATS[beatIndex]!;
  // No background, field, or sheen on the Stage: this is an overlay, not a
  // screen — the live game and its own HUD stay visible underneath, with the
  // countdown chrome settling in over them (reference 1q).
  return (
    <Stage className={s.screen}>
      <div className={[s.grid, s.hud].join(' ')}>
        <span className={s.gridPlace} data-df-numeric>{String(gridSpot).padStart(2, '0')}</span>
        <span className={s.gridMeta}>
          <span className={s.gridField}>/{field}</span>
          <span className={s.gridCaption}>GRID SPOT</span>
        </span>
      </div>

      <div className={[s.checkpoints, s.hud].join(' ')}>
        <span className={s.cpLabel}>CHECKPOINT 00 / {String(checkpoints).padStart(2, '0')}</span>
        <Pips total={checkpoints} done={0} />
        {personalBest && <span className={s.pb}>{personalBest}</span>}
      </div>

      <div className={s.round}>
        <span className={s.roundNo}>ROUND {round} OF {rounds}</span>
        <span className={s.roundTrack}>{track}</span>
        <Chip tone="race">{mode}</Chip>
      </div>

      <div className={s.counter}>
        <svg className={s.ring} viewBox="0 0 120 120" aria-hidden="true">
          <circle className={s.ringDisc} cx="60" cy="60" r="52" />
          <circle key={beat} className={s.ringSweep} cx="60" cy="60" r="52" transform="rotate(-90 60 60)" />
        </svg>
        {/* One beat at a time, remounted on its key so the pop fires once per
            beat — the server's next snapshot swaps the key, never a timer.
            `status` takes no name from content, so the beat rides an
            aria-label: screen readers announce the count, and tests can. */}
        <span key={beat} role="status" aria-label={beat} className={[s.beat, beat === 'GO!' && s.go].filter(Boolean).join(' ')}>{beat}</span>
      </div>

      <p className={s.feed}>GAMEPLAY FEED · BEANS ON THE START LINE</p>

      <div className={s.line}>
        <span className={s.lineLabel}>ON THE LINE</span>
        <span className={s.lineBeans}>
          {onTheLine.map((skin, i) => (
            <Avatar key={i} skin={skin} size={2.65} ring={i === 0 ? 'var(--df-color-accent)' : undefined} />
          ))}
          <span className={s.more}>+{othersOnTheLine}</span>
        </span>
      </div>

      <div className={s.beats}>
        {BEATS.map((b, i) => (
          <span key={b} className={[s.beatChip, i <= beatIndex && s.beatChipLit].filter(Boolean).join(' ')}>{b}</span>
        ))}
      </div>
    </Stage>
  );
}
