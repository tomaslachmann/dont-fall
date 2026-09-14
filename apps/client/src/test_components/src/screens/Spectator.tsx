import { useState } from 'react';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import Avatar from '../ui/Avatar';
import type { Skin } from '../ui/Avatar';
import Chip from '../ui/Chip';
import type { Feel } from '../tokens';
import s from './Spectator.module.css';

export interface Runner {
  name: string;
  skin: Skin;
  /** e.g. "2ND · 6 GRABS" */
  form: string;
  odds: number;
  favourite?: boolean;
  longshot?: boolean;
}

export interface SpectatorProps {
  following?: string;
  followingSkin?: Skin;
  place?: string;
  aliveFor?: string;
  beansLeft?: number;
  round?: string;
  yourExit?: string;
  runners?: Runner[];
  closesIn?: string;
  balance?: number;
  onLeave?: () => void;
  feel?: Feel;
}

const RUNNERS: Runner[] = [
  { name: 'FLOPPO', skin: 'cyan', form: '2ND · 6 GRABS', odds: 2.4, favourite: true },
  { name: 'GOOPY', skin: 'mint', form: '1ST · UNTOUCHED', odds: 1.8 },
  { name: 'SPLATTO', skin: 'gold', form: '3RD · WOBBLING', odds: 5.0 },
  { name: 'BONK', skin: 'pink', form: '4TH · ON THE EDGE', odds: 9.5, longshot: true },
];

const STAKES = [25, 100, 250];

export default function Spectator({
  following = 'FLOPPO', followingSkin = 'cyan', place = '#2', aliveFor = '05:07',
  beansLeft = 4, round = 'ROUND 2 · SURVIVAL', yourExit = 'YOU WENT OUT #7',
  runners = RUNNERS, closesIn = '0:18', balance = 1240, onLeave, feel,
}: SpectatorProps) {
  const [pick, setPick] = useState(runners[0].name);
  const [stake, setStake] = useState(100);

  const picked = runners.find((r) => r.name === pick) ?? runners[0];
  const payout = Math.round(stake * picked.odds);

  return (
    <Stage
      background="var(--df-stage-tension)"
      field="var(--df-field-dash)"
      sheen="var(--df-sheen-lift)"
      feel={feel}
      className={s.screen}
      overlay={<div className={s.border} />}
    >
      <div className={s.following}>
        <Avatar skin={followingSkin} size={3.4} ring="var(--df-color-accent)" />
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
        <Chip tone="out" lg>{yourExit}</Chip>
      </div>

      <p className={s.feed}>GAMEPLAY FEED<br />FOLLOWING ANOTHER BEAN</p>

      <div className={s.ticker}>
        <Avatar skin="mint" size={2.65} />
        <span className={s.tickerText}>
          <span className={s.tickerMain}>MRBEANO STAKED 500 ON GOOPY</span>
          <span className={s.tickerSub}>14 SPECTATORS BETTING</span>
        </span>
      </div>

      <div className={s.switcher}>
        <span className={s.key}><span className={s.keyCap}>Q</span><span className={s.keyLabel}>PREV</span></span>
        <span className={s.beans}>
          {runners.map((r) => (
            <button
              key={r.name}
              type="button"
              aria-label={`Spectate ${r.name}`}
              onClick={() => setPick(r.name)}
              className={[s.bean, r.name === following && s.beanOn].filter(Boolean).join(' ')}
            >
              <Avatar skin={r.skin} size={r.name === following ? 4.4 : 3.1} ring={r.name === following ? 'var(--df-color-accent)' : undefined} />
            </button>
          ))}
        </span>
        <span className={s.key}><span className={s.keyLabel}>NEXT</span><span className={s.keyCap}>E</span></span>
        <span className={s.sep} />
        <JellyButton variant="pill" tone="glass" centered feel={feel}>FREE CAM</JellyButton>
        <JellyButton variant="pill" tone="danger" centered feel={feel} onClick={onLeave}>LEAVE</JellyButton>
      </div>

      <Panel className={s.bets}>
        <div className={s.betsHead}>
          <span className={s.betsTitle}>WHO TAKES IT?</span>
          <Chip tone="closing">CLOSES {closesIn}</Chip>
        </div>
        <span className={s.betsNote}>Stake jelly beans on the survivor. Payout is odds × stake.</span>

        <div className={s.runners}>
          {runners.map((r) => (
            <button
              key={r.name}
              type="button"
              onClick={() => setPick(r.name)}
              aria-pressed={r.name === pick}
              className={[s.runner, r.name === pick && s.picked].filter(Boolean).join(' ')}
            >
              <Avatar skin={r.skin} size={3.1} />
              <span className={s.runnerText}>
                <span className={s.runnerName}>{r.name}</span>
                <span className={s.runnerForm}>{r.form}</span>
              </span>
              <span className={s.oddsWrap}>
                <span className={[s.odds, r.favourite && s.favourite, r.longshot && s.longshot].filter(Boolean).join(' ')} data-df-numeric>
                  ×{r.odds.toFixed(1)}
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
              onClick={() => setStake(v)}
              className={[s.stake, v === stake && s.stakeOn].filter(Boolean).join(' ')}
            >{v}</button>
          ))}
          <button
            type="button"
            onClick={() => setStake(balance)}
            className={[s.stake, stake === balance && s.stakeOn].filter(Boolean).join(' ')}
          >ALL IN</button>
        </div>

        <JellyButton
          variant="tile"
          feel={feel}
          sub={`ON ${picked.name} · WINS ${payout}`}
        >STAKE {stake}</JellyButton>

        <div className={s.balance}>
          <span className={s.balanceLabel}>YOUR JELLY BEANS</span>
          <span className={s.balanceValue} data-df-numeric>{balance.toLocaleString('en-US').replace(/,/g, ' ')}</span>
        </div>
      </Panel>
    </Stage>
  );
}
