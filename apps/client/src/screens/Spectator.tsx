import { useState } from 'react';
import { stakePayout } from '@dont-fall/shared';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import Avatar from '../ui/Avatar';
import type { AvatarLook } from '../lib/avatar.js';
import Chip from '../ui/Chip';
import type { Feel } from '../tokens';
import s from './Spectator.module.css';

export interface Runner {
  id: string;
  name: string;
  look: AvatarLook;
  /** e.g. "2ND" — omitted when unknown (mid-Round places exist for the followed bean only). */
  form?: string;
  /** Live pari-mutuel odds — null while nobody backed them (renders a dash, never a guess). */
  odds: number | null;
  /** Beans already staked on this runner — with `totalPool`, what a stake is quoted from. */
  pool?: number;
  favourite?: boolean;
  longshot?: boolean;
}

export interface SpectatorBetTicker {
  main: string;
  sub: string;
  /** Whoever staked the latest ticket (ADR 0110). */
  look?: AvatarLook;
}

export interface SpectatorProps {
  following?: string;
  /** Highlights the followed bean — the camera's truth, not the bet pick. */
  followingId?: string;
  followingLook?: AvatarLook;
  place?: string;
  aliveFor?: string;
  beansLeft?: number;
  round?: string;
  /** e.g. "YOU WENT OUT #7" — null for a mid-Match joiner with no exit (hides the chip, never a default). */
  yourExit?: string | null;
  runners?: Runner[];
  /** Latest ticket + bettor count — null while nothing is staked yet. */
  ticker?: SpectatorBetTicker | null;
  /**
   * When betting closes, after CLOSES — "AT 1 LEFT" live (ADR 0110) — or null
   * once the board is closed (the CLOSED chip). Omitted only for the
   * prop-less preview, which keeps the mock countdown.
   */
  closesIn?: string | null;
  /** This Account's beans — null while the balance is still loading. */
  balance?: number | null;
  /** Every bean staked on this Round so far — with each runner's `pool`, what WINS N quotes. */
  totalPool?: number;
  onFollow?: (playerId: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
  onFreeCam?: () => void;
  freeCam?: boolean;
  /** Stakes one ticket — may reject (broke, closed mid-tap); the panel shows the refusal inline. */
  onStake?: (targetId: string, amount: number) => Promise<void>;
  onLeave?: () => void;
  feel?: Feel;
}

const RUNNERS: Runner[] = [
  { id: 'floppo', name: 'FLOPPO', look: { src: null, color: 1 }, form: '2ND · 6 GRABS', odds: 2.4, favourite: true },
  { id: 'goopy', name: 'GOOPY', look: { src: null, color: 2 }, form: '1ST · UNTOUCHED', odds: 1.8 },
  { id: 'splatto', name: 'SPLATTO', look: { src: null, color: 3 }, form: '3RD · WOBBLING', odds: 5.0 },
  { id: 'bonk', name: 'BONK', look: { src: null, color: 0 }, form: '4TH · ON THE EDGE', odds: 9.5, longshot: true },
];

const STAKES = [25, 100, 250];

export default function Spectator({
  following = 'FLOPPO', followingId = 'floppo', followingLook = { src: null, color: 1 }, place = '#2', aliveFor = '05:07',
  beansLeft = 4, round = 'ROUND 2 · SURVIVAL', yourExit = null,
  runners = RUNNERS, ticker = { main: 'MRBEANO STAKED 500 ON GOOPY', sub: '14 SPECTATORS BETTING' },
  closesIn = '0:18', balance = 1240, totalPool,
  onFollow, onPrev, onNext, onFreeCam, freeCam, onStake, onLeave, feel,
}: SpectatorProps) {
  const [pick, setPick] = useState(runners[0]?.name ?? '');
  const [stake, setStake] = useState(100);
  const [staking, setStaking] = useState(false);
  const [stakeFailed, setStakeFailed] = useState<string | null>(null);

  const picked = runners.find((r) => r.name === pick);
  // Quoted with this stake already in the pools (ADR 0110): the odds on the
  // board are before it, and a stake moves them. The pool-less preview keeps
  // the odds.
  const payout =
    picked === undefined
      ? null
      : picked.pool !== undefined && totalPool !== undefined
        ? stakePayout(stake, picked.pool, totalPool)
        : picked.odds === null
          ? null
          : Math.floor(stake * picked.odds);
  // A closed board refuses stakes outright — `closesIn` null IS the closed
  // state, so the button dies with the chip instead of posting into a 400.
  const canStake =
    onStake !== undefined && picked !== undefined && !staking && closesIn !== null &&
    balance !== null && stake >= 1 && stake <= balance;

  const fireStake = () => {
    if (!canStake || picked === undefined) return;
    setStaking(true);
    setStakeFailed(null);
    void (async () => {
      try {
        await onStake!(picked.id, stake);
      } catch (err) {
        setStakeFailed(err instanceof Error ? err.message : 'That stake failed.');
      } finally {
        setStaking(false);
      }
    })();
  };

  // No background, field, or sheen on the Stage: this sits over the live
  // Round (reference 1j) — the followed bean stays visible behind the
  // chrome, with the gold ring marking the spectate view.
  return (
    <Stage
      feel={feel}
      className={s.screen}
      overlay={<div className={s.border} />}
    >
      <div className={s.following}>
        <Avatar look={followingLook} size={3.4} ring="var(--df-color-accent)" />
        <span className={s.followMeta}>
          <span className={s.followKicker}>SPECTATING</span>
          <span className={s.followName}>{following}</span>
        </span>
        <span className={s.sep} />
        <span className={s.followMeta}>
          <span className={s.statLabel}>PLACE</span>
          <span className={s.statValue}>{place}</span>
        </span>
        <span className={s.followMeta}>
          <span className={s.statLabel}>ALIVE FOR</span>
          <span className={s.statValue} data-df-numeric>{aliveFor}</span>
        </span>
      </div>

      <div className={s.tags}>
        <Chip tone="plate" lg>{String(beansLeft).padStart(2, '0')} BEANS LEFT</Chip>
        <Chip tone="plate" lg>{round}</Chip>
        {yourExit && <Chip tone="out" lg>{yourExit}</Chip>}
      </div>

      {/* The design's caption for its picture of the game stood here; the live
          game shows through instead, and the cell keeps the grid in place. */}
      <span className={s.feed} />

      {ticker && (
        <div className={s.ticker}>
          <Avatar look={ticker.look ?? { src: null, color: 2 }} size={2.65} />
          <span className={s.tickerText}>
            <span className={s.tickerMain}>{ticker.main}</span>
            <span className={s.tickerSub}>{ticker.sub}</span>
          </span>
        </div>
      )}

      <div className={s.switcher}>
        <button type="button" className={s.key} onClick={onPrev} aria-label="Spectate previous bean">
          <span className={s.keyCap}>Q</span><span className={s.keyLabel}>PREV</span>
        </button>
        <span className={s.beans}>
          {runners.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-label={`Spectate ${r.name}`}
              onClick={() => onFollow?.(r.id)}
              className={[s.bean, r.id === followingId && s.beanOn].filter(Boolean).join(' ')}
            >
              <Avatar look={r.look} size={r.id === followingId ? 4.4 : 3.1} ring={r.id === followingId ? 'var(--df-color-accent)' : undefined} />
            </button>
          ))}
        </span>
        <button type="button" className={s.key} onClick={onNext} aria-label="Spectate next bean">
          <span className={s.keyLabel}>NEXT</span><span className={s.keyCap}>E</span>
        </button>
        <span className={s.sep} />
        <JellyButton variant="pill" tone="glass" centered onClick={onFreeCam}>FREE CAM{freeCam ? ' · ON' : ''}</JellyButton>
        <JellyButton variant="pill" tone="danger" centered sound="back" onClick={onLeave}>LEAVE</JellyButton>
      </div>

      {runners.length > 0 && (
        <Panel className={s.bets}>
          <div className={s.betsHead}>
            <span className={s.betsTitle}>WHO TAKES IT?</span>
            {closesIn ? <Chip tone="closing">CLOSES {closesIn}</Chip> : <Chip tone="plate">CLOSED</Chip>}
          </div>
          <span className={s.betsNote}>Stake jelly beans on the survivor. Payout is odds × stake.</span>

          <div className={s.runners}>
            {runners.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => { setPick(r.name); setStakeFailed(null); }}
                aria-pressed={r.name === pick}
                className={[s.runner, r.name === pick && s.picked].filter(Boolean).join(' ')}
              >
                <Avatar look={r.look} size={3.1} />
                <span className={s.runnerText}>
                  <span className={s.runnerName}>{r.name}</span>
                  {r.form && <span className={s.runnerForm}>{r.form}</span>}
                </span>
                <span className={s.oddsWrap}>
                  <span className={[s.odds, r.favourite && s.favourite, r.longshot && s.longshot].filter(Boolean).join(' ')} data-df-numeric>
                    {r.odds === null ? '—' : `×${r.odds.toFixed(1)}`}
                  </span>
                  {r.favourite && <span className={s.oddsTag}>FAVOURITE</span>}
                </span>
              </button>
            ))}
          </div>

          <div className={s.stakes}>
            {STAKES.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => { setStake(v); setStakeFailed(null); }}
                disabled={balance === null || v > balance}
                className={[s.stake, v === stake && s.stakeOn].filter(Boolean).join(' ')}
              >{v}</button>
            ))}
            <button
              type="button"
              onClick={() => { if (balance !== null) { setStake(balance); setStakeFailed(null); } }}
              disabled={balance === null}
              className={[s.stake, balance !== null && stake === balance && s.stakeOn].filter(Boolean).join(' ')}
            >ALL IN</button>
          </div>

          <JellyButton
            variant="tile"
            sub={picked && payout !== null ? `ON ${picked.name} · WINS ${payout}` : undefined}
            disabled={!canStake}
            onClick={fireStake}
          >STAKE {staking ? '…' : stake}</JellyButton>
          {stakeFailed && <span className={s.stakeFailed}>{stakeFailed}</span>}

          <div className={s.balance}>
            <span className={s.balanceLabel}>YOUR JELLY BEANS</span>
            <span className={s.balanceValue} data-df-numeric>{balance === null ? '—' : balance.toLocaleString('en-US').replace(/,/g, ' ')}</span>
          </div>
        </Panel>
      )}
    </Stage>
  );
}
