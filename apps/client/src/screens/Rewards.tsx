import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import { CharacterPreview, WIN_SEQUENCE } from './CharacterPreview.js';
import type { Feel } from '../tokens';
import s from './Rewards.module.css';

export interface RewardsProps {
  level?: number;
  /**
   * Whose beans these are — the celebrating bean wears their color, or the
   * default when the Account didn't load. Shows under no `skin`.
   */
  color?: number | null;
  /** And their skin (ADR 0091), or none — which is what shows the `color`. */
  skin?: string | null;
  /** And their hat (ADR 0083), or none. */
  hat?: string | null;
  xpGain?: number;
  /** Fraction of the bar you already had, 0-1. */
  xpBefore?: number;
  /** Fraction added by this match, 0-1. */
  xpEarned?: number;
  breakdown?: Array<[string, number]>;
  beans?: number;
  beansSplit?: Array<[string, number]>;
  /** What this Match unlocked, by name — the card hides without one. */
  unlock?: string | undefined;
  /** Its picture on the card, when there is one. */
  unlockIcon?: string | undefined;
  /** The level the unlocked item needs — what UNLOCKED AT names (defaults to `level`). */
  unlockLevel?: number | undefined;
  onPlayAgain?: () => void;
  /**
   * Why PLAY AGAIN cannot be pressed, shown as its kicker (ADR 0112): a Party
   * member's is the host's call, and the host's waits for its members. Unset,
   * it plays.
   */
  playAgainBlocked?: string | null | undefined;
  onLobby?: () => void;
  /** Puts the unlocked hat on — the button hides without one. */
  onEquip?: (() => void) | undefined;
  onExit?: () => void;
  feel?: Feel;
}

const BREAKDOWN: Array<[string, number]> = [
  ['3 ROUNDS', 600],
  ['2ND PLACE', 400],
  ['6 GRABS BROKEN', 240],
];

const SPLIT: Array<[string, number]> = [['MATCH', 600], ['BET WON', 260]];

const ReplayIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
    <path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 3v5h-5" />
  </svg>
);

export default function Rewards({
  level = 43, xpGain = 1240, xpBefore = 0.46, xpEarned = 0.31,
  breakdown = BREAKDOWN, beans = 860, beansSplit = SPLIT,
  color = null, skin = null, hat = null,
  unlock, unlockIcon, unlockLevel, onPlayAgain, playAgainBlocked, onLobby, onEquip, onExit, feel,
}: RewardsProps) {
  return (
    <Stage
      background="var(--df-stage-reward)"
      sheen="radial-gradient(circle at 50% 30%, rgba(255,210,63,.35), transparent 55%)"
      feel={feel}
      className={s.screen}
    >
      <div className={s.headline}>
        <span className={s.kicker}>MATCH REWARDS</span>
        <span className={s.level}>LEVEL {level}</span>
      </div>

      <CharacterPreview
        color={color}
        skin={skin}
        hat={hat}
        animation={WIN_SEQUENCE}
        autoRotate={false}
        className={s.render}
        sub="LEVEL-UP POSE"
        canvasLabel="3D preview of your bean celebrating"
      />

      <div className={s.cards}>
        <Panel className={s.xp}>
          <div className={s.xpHead}>
            <span className={s.xpTitle}>EXPERIENCE</span>
            <span className={s.xpGain} data-df-numeric>+{xpGain.toLocaleString('en-US').replace(/,/g, ' ')}</span>
          </div>

          <div className={s.bar}>
            <span className={s.node}>{level}</span>
            <span className={s.track}>
              <span className={s.had} style={{ width: `${xpBefore * 100}%` }} />
              <span className={s.earned} style={{ width: `${xpEarned * 100}%` }} />
            </span>
            <span className={[s.node, s.nodeNext].join(' ')}>{level + 1}</span>
          </div>

          <div className={s.breakdown}>
            {breakdown.map(([label, value]) => (
              <span key={label} className={s.reason}>
                <span className={s.reasonLabel}>{label}</span>
                <span className={s.reasonValue} data-df-numeric>+{value}</span>
              </span>
            ))}
          </div>
        </Panel>

        <div className={s.pair}>
          <div className={s.beans}>
            <span className={s.beansLabel}>JELLY BEANS</span>
            <span className={s.beansRow}>
              <span className={s.coin} />
              <span className={s.beansValue} data-df-numeric>+{beans}</span>
            </span>
            <span className={s.beansSplit}>
              {beansSplit.map(([label, value]) => (
                <span key={label} className={s.split}>
                  {label} <span className={s.splitValue} data-df-numeric>{value}</span>
                </span>
              ))}
            </span>
          </div>

          {unlock && (
          <div className={s.unlock}>
            <span className={s.unlockLabel}>UNLOCKED AT {unlockLevel ?? level}</span>
            <span className={s.unlockRow}>
              <span
                className={s.item}
                style={unlockIcon ? { background: `center / contain no-repeat url("${unlockIcon}")`, boxShadow: 'none' } : undefined}
              />
              <span className={s.itemText}>
                <span className={s.itemName}>{unlock}</span>
                <span className={s.itemHint}>EQUIP IN YOUR BEAN</span>
              </span>
            </span>
          </div>
          )}
        </div>
      </div>

      <div className={s.actions}>
        <JellyButton
          variant="tile" tone="go" centered sound="confirm" onClick={onPlayAgain} icon={<ReplayIcon />}
          disabled={Boolean(playAgainBlocked)} kicker={playAgainBlocked || undefined}
        >
          PLAY AGAIN
        </JellyButton>
        <JellyButton variant="pill" tone="glass" centered sound="back" onClick={onLobby}>BACK TO LOBBY</JellyButton>
        {onEquip && (
        <JellyButton variant="pill" tone="glass" centered onClick={onEquip}>EQUIP NEW HAT</JellyButton>
        )}
        {onExit && (
        <JellyButton variant="pill" tone="glass" centered sound="back" onClick={onExit}>EXIT</JellyButton>
        )}
      </div>
    </Stage>
  );
}
