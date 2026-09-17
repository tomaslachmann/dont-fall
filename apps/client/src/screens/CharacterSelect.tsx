import { useState } from 'react';
import { BASE_BODY_SKIN_ID, HATS } from '@dont-fall/shared';
import { hatIconUrl } from '../lib/hatAssets.js';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import type { Feel } from '../tokens';
import { Turntable } from './Turntable';
import s from './CharacterSelect.module.css';

export type CosmeticTab = 'BODY' | 'PATTERN' | 'HAT' | 'EMOTES';

const TABS: CosmeticTab[] = ['BODY', 'PATTERN', 'HAT', 'EMOTES'];

/**
 * Owned skins as stripe pairs — stands in for the real cosmetic art. In
 * `bodySkin` id order, base (`BASE_BODY_SKIN_ID`) last: its stripes are
 * BLIP's own authored cream, the one swatch that shows a real color.
 */
const SKINS: Array<[string, string]> = [
  ['#FFB4DC', '#FF8AC6'],
  ['#7FE3FF', '#3FC4FF'],
  ['#B6F5A0', '#7FE07F'],
  ['#FFD9A0', '#FFB25E'],
  ['#D9C9F5', '#C4AFEF'],
  ['#FFC0C0', '#FF9E9E'],
  ['#C9F0FF', '#A8E4FF'],
  ['#F3DFC3', '#D3C2AA'],
];

export interface CharacterSelectProps {
  equipped?: string;
  onBack?: () => void;
  onSave?: () => void;
  onShop?: () => void;
  feel?: Feel;
  /** Controlled pick — the Route owns it (it must survive the async account load and reach SAVE). */
  selected: number;
  onSelect?: (index: number) => void;
  /** Controlled hat pick (ADR 0083), owned by the Route like the skin — `null` for none. */
  hat?: string | null;
  onSelectHat?: (hat: string | null) => void;
  /** The Account's level: a hat above it shows locked, with the level it needs. */
  level?: number;
}

const stripe = ([a, b]: [string, string]) =>
  `repeating-linear-gradient(45deg,${a} 0 calc(var(--df-u) * .62),${b} calc(var(--df-u) * .62) calc(var(--df-u) * 1.25))`;

const LockIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
);

export default function CharacterSelect({
  equipped = 'BUBBLEGUM BEAN', onBack, onSave, onShop, feel, selected, onSelect,
  hat = null, onSelectHat, level = 1,
}: CharacterSelectProps) {
  const [tab, setTab] = useState<CosmeticTab>('BODY');
  // Turntable one-shots — counters, not booleans, so a second click re-fires.
  const [spinToken, setSpinToken] = useState(0);
  const [emoteToken, setEmoteToken] = useState(0);

  return (
    <Stage background="var(--df-stage-lobby)" sheen="var(--df-sheen-menu)" feel={feel} className={s.screen}>
      <div className={s.topbar}>
        <button type="button" className={s.back} data-ui-sound="back" onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 18 18"><path d="M11 3L5 9l6 6" /></svg>
        </button>
        <span className={s.title}>YOUR BEAN</span>
      </div>

      <div className={s.turntable}>
        <Turntable skin={selected} hat={hat} spinToken={spinToken} emoteToken={emoteToken} />
        <span className={s.shadow} />
        <div className={s.turnActions}>
          <JellyButton variant="pill" tone="glass" centered onClick={() => setSpinToken((t) => t + 1)}>ROTATE</JellyButton>
          <JellyButton variant="pill" centered onClick={() => setEmoteToken((t) => t + 1)}>PLAY EMOTE</JellyButton>
          <JellyButton
            variant="pill"
            tone="glass"
            centered
            onClick={() => {
              // A different skin every time — re-rolling the current pick would look dead.
              let next = Math.floor(Math.random() * SKINS.length);
              if (next === selected) next = (next + 1) % SKINS.length;
              onSelect?.(next);
            }}
          >RANDOMISE</JellyButton>
        </div>
      </div>

      <Panel className={s.cosmetics}>
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

        <div className={s.grid}>
          {tab === 'HAT' ? (
            <>
              <button
                type="button"
                aria-label="No hat"
                aria-pressed={hat === null}
                onClick={() => onSelectHat?.(null)}
                className={[s.swatch, s.hatTile, hat === null && s.selected].filter(Boolean).join(' ')}
              >NONE</button>
              {HATS.map((def) => level >= def.unlockLevel ? (
                <button
                  key={def.id}
                  type="button"
                  aria-label={def.name}
                  aria-pressed={hat === def.id}
                  onClick={() => onSelectHat?.(def.id)}
                  className={[s.swatch, s.hatTile, hat === def.id && s.selected].filter(Boolean).join(' ')}
                >
                  <img src={hatIconUrl(def.id)} alt="" className={s.hatIcon} draggable={false} />
                </button>
              ) : (
                <span
                  key={def.id}
                  title={`${def.name} unlocks at level ${def.unlockLevel}`}
                  className={[s.swatch, s.hatTile, s.hatLocked].join(' ')}
                >
                  <img src={hatIconUrl(def.id)} alt="" className={s.hatIcon} draggable={false} />
                  <LockIcon />
                  <span className={s.lockLabel}>LV {def.unlockLevel}</span>
                </span>
              ))}
            </>
          ) : (
          <>
          {SKINS.map((pair, i) => (
            <button
              key={i}
              type="button"
              aria-label={i === BASE_BODY_SKIN_ID ? 'Base' : `Skin ${i + 1}`}
              aria-pressed={i === selected}
              onClick={() => onSelect?.(i)}
              className={[s.swatch, i === selected && s.selected].filter(Boolean).join(' ')}
              style={{ background: stripe(pair) }}
            />
          ))}
          <span className={[s.swatch, s.locked].join(' ')}><LockIcon /><span className={s.lockLabel}>LV 45</span></span>
          <span className={[s.swatch, s.locked].join(' ')}><LockIcon /></span>
          <span className={[s.swatch, s.shopOnly].join(' ')}>SHOP<br />ONLY</span>
          </>
          )}
        </div>

        <div className={s.equipped}>
          <span className={s.equippedText}>
            <span className={s.equippedLabel}>EQUIPPED</span>
            <span className={s.equippedName}>{equipped}</span>
          </span>
          <JellyButton variant="pill" tone="go" centered sound="confirm" onClick={onSave}>SAVE</JellyButton>
        </div>
      </Panel>

      <div className={s.foot}>
        <JellyButton variant="pill" tone="glass" centered>NAME CARD</JellyButton>
        <JellyButton variant="pill" tone="glass" centered>VICTORY POSE</JellyButton>
        <JellyButton variant="pill" tone="glass" centered onClick={onShop}>OPEN SHOP</JellyButton>
      </div>
    </Stage>
  );
}
