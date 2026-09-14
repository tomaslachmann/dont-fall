import { useState } from 'react';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import Avatar from '../ui/Avatar';
import type { Skin } from '../ui/Avatar';
import Chip from '../ui/Chip';
import Stepper from '../ui/Stepper';
import ReadySwitch from '../ui/ReadySwitch';
import type { Feel } from '../tokens';
import s from './Lobby.module.css';

export interface LobbyPlayer {
  name: string;
  skin: Skin;
  ready?: boolean;
  host?: boolean;
}

export interface LobbyRound {
  track: string;
  mode: 'RACE' | 'SURVIVAL' | 'ANY MODE';
  /** Thumbnail stripe colors — stands in for the real track art. */
  thumb: [string, string];
  /** Track not chosen yet. */
  random?: boolean;
}

export interface LobbyProps {
  room?: string;
  capacity?: number;
  players?: LobbyPlayer[];
  rounds?: LobbyRound[];
  autoStart?: string;
  onBack?: () => void;
  onInvite?: () => void;
  onStart?: () => void;
  feel?: Feel;
}

const PLAYERS: LobbyPlayer[] = [
  { name: 'NOODLEBEAN', skin: 'pink', ready: true, host: true },
  { name: 'FLOPPO', skin: 'cyan', ready: true },
  { name: 'GOOPY', skin: 'mint', ready: true },
  { name: 'SPLATTO', skin: 'gold', ready: true },
  { name: 'MRBEANO', skin: 'grape' },
  { name: 'TUMBLEWEED', skin: 'grape' },
  { name: 'BONK', skin: 'pink' },
];

const ROUNDS: LobbyRound[] = [
  { track: 'SLIP CITY LOOP', mode: 'RACE', thumb: ['#BFE9FF', '#9CDCFF'] },
  { track: 'JELLY GAUNTLET', mode: 'SURVIVAL', thumb: ['#FFC9E4', '#FFB4DC'] },
  { track: 'RANDOM PICK', mode: 'ANY MODE', thumb: ['#E7DDFA', '#DCCFF7'], random: true },
];

const MODE_TONE = { RACE: 'race', SURVIVAL: 'survival', 'ANY MODE': 'any' } as const;

const stripe = ([a, b]: [string, string]) =>
  `repeating-linear-gradient(115deg,${a} 0 calc(var(--df-u) * .7),${b} calc(var(--df-u) * .7) calc(var(--df-u) * 1.4))`;

const SwapIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h6l8 10h4" /><path d="M18 3l3 4-3 4" /><path d="M3 17h6" /></svg>
);

export default function Lobby({
  room = 'WOBBLE-4471', capacity = 16, players = PLAYERS, rounds = ROUNDS,
  autoStart = '0:24', onBack, onInvite, onStart, feel,
}: LobbyProps) {
  const [ready, setReady] = useState(true);
  const [roundCount, setRoundCount] = useState(rounds.length);

  const readyCount = players.filter((p) => p.ready).length;
  const open = capacity - players.length;

  return (
    <Stage background="var(--df-stage-lobby)" sheen="var(--df-sheen-menu)" feel={feel} className={s.screen}>
      <div className={s.topbar}>
        <div className={s.crumb}>
          <button type="button" className={s.back} onClick={onBack} aria-label="Back">
            <svg viewBox="0 0 18 18"><path d="M11 3L5 9l6 6" /></svg>
          </button>
          <span className={s.title}>LOBBY</span>
          <span className={s.room}>
            <span className={s.roomLabel}>ROOM</span>
            <span className={s.roomCode}>{room}</span>
          </span>
        </div>
        <div className={s.topActions}>
          <JellyButton variant="pill" tone="glass" centered feel={feel} onClick={onInvite}>INVITE FRIENDS</JellyButton>
          <Chip tone="plate" lg>PRIVATE</Chip>
        </div>
      </div>

      <div className={s.room_col}>
        <div className={s.count}>
          <span className={s.countLabel}>BEANS IN THE ROOM</span>
          <span className={s.countValue} data-df-numeric>
            {String(players.length).padStart(2, '0')}<span className={s.countTotal}>/{capacity}</span>
          </span>
        </div>

        <div className={s.grid}>
          {players.map((p) => (
            <div key={p.name} className={[s.player, !p.ready && s.pending].filter(Boolean).join(' ')}>
              <div className={s.playerHead}>
                <Avatar skin={p.skin} size={4} />
                {p.host && <Chip tone="host">HOST</Chip>}
              </div>
              <span className={s.playerName}>{p.name}</span>
              <Chip tone={p.ready ? 'ready' : 'waiting'} dot>{p.ready ? 'READY' : 'WAITING'}</Chip>
            </div>
          ))}
          {open > 0 && (
            <div className={s.slots}>
              <span className={s.slotsPlus}>+</span>
              <span className={s.slotsLabel}>{open} SLOTS OPEN</span>
            </div>
          )}
        </div>

        <div className={s.foot}>
          <ReadySwitch
            ready={ready}
            onChange={setReady}
            tally={`${readyCount} OF ${players.length} READY`}
            hint={`WAITING ON ${players.length - readyCount} BEANS`}
          />
        </div>
      </div>

      <div className={s.room_col}>
        <Panel className={s.setup} style={{ gridRow: 'span 2' }}>
          <div className={s.setupHead}>
            <span>
              <span className={s.setupTitle}>ROUNDS</span>
              <span className={s.setupSub}>HOST ONLY</span>
            </span>
            <Stepper value={roundCount} onChange={setRoundCount} />
          </div>

          <div className={s.rounds}>
            {rounds.map((r, i) => (
              <div key={r.track} className={[s.round, r.random && s.roundActive].filter(Boolean).join(' ')}>
                <span className={s.roundNo}>{i + 1}</span>
                <span className={s.thumb} style={{ background: stripe(r.thumb) }}>{r.random ? '?' : ''}</span>
                <span className={s.roundText}>
                  <span className={s.roundName}>{r.track}</span>
                  <span><Chip tone={MODE_TONE[r.mode]}>{r.mode}</Chip></span>
                </span>
                <button type="button" className={s.swap} aria-label={`Change round ${i + 1}`}><SwapIcon /></button>
              </div>
            ))}
            <button type="button" className={s.addRound}>+ ADD ROUND</button>
          </div>

          <div className={s.setupFoot}>
            <button type="button" className={s.ghost}>SHUFFLE ALL</button>
            <button type="button" className={s.ghost}>BROWSE TRACKS</button>
          </div>
        </Panel>

        <JellyButton
          feel={feel}
          className={s.start}
          kicker={`${rounds.length} ROUNDS · AUTO-START IN ${autoStart}`}
          onClick={onStart}
        >START MATCH</JellyButton>
      </div>
    </Stage>
  );
}
