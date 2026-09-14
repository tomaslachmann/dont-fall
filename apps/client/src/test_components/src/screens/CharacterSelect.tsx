import { useState } from 'react';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import type { Feel } from '../tokens';
import s from './CharacterSelect.module.css';

export type CosmeticTab = 'BODY' | 'PATTERN' | 'HAT' | 'EMOTES';

const TABS: CosmeticTab[] = ['BODY', 'PATTERN', 'HAT', 'EMOTES'];

/** Owned skins as stripe pairs — stands in for the real cosmetic art. */
const SKINS: Array<[string, string]> = [
  ['#FFB4DC', '#FF8AC6'],
  ['#7FE3FF', '#3FC4FF'],
  ['#B6F5A0', '#7FE07F'],
  ['#FFD9A0', '#FFB25E'],
  ['#D9C9F5', '#C4AFEF'],
  ['#FFC0C0', '#FF9E9E'],
  ['#C9F0FF', '#A8E4FF'],
];

export interface CharacterSelectProps {
  equipped?: string;
  onBack?: () => void;
  onSave?: () => void;
  onShop?: () => void;
  feel?: Feel;
}

const stripe = ([a, b]: [string, string]) =>
  `repeating-linear-gradient(45deg,${a} 0 calc(var(--df-u) * .62),${b} calc(var(--df-u) * .62) calc(var(--df-u) * 1.25))`;

const LockIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
);

export default function CharacterSelect({
  equipped = 'BUBBLEGUM BEAN', onBack, onSave, onShop, feel,
}: CharacterSelectProps) {
  const [tab, setTab] = useState<CosmeticTab>('BODY');
  const [selected, setSelected] = useState(0);

  return (
    <Stage background="var(--df-stage-lobby)" sheen="var(--df-sheen-menu)" feel={feel} className={s.screen}>
      <div className={s.topbar}>
        <button type="button" className={s.back} onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 18 18"><path d="M11 3L5 9l6 6" /></svg>
        </button>
        <span className={s.title}>YOUR BEAN</span>
      </div>

      <div className={s.turntable}>
        <span className={s.turnCaption}>
          LIVE 3D CHARACTER RENDER · TURNTABLE + IDLE<br />EXISTING CHARACTER, EXISTING COSMETICS
        </span>
        <span />
        <span className={s.shadow} />
        <div className={s.turnActions}>
          <JellyButton variant="pill" tone="glass" centered feel={feel}>ROTATE</JellyButton>
          <JellyButton variant="pill" centered feel={feel}>PLAY EMOTE</JellyButton>
          <JellyButton variant="pill" tone="glass" centered feel={feel}>RANDOMISE</JellyButton>
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
          {SKINS.map((pair, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Skin ${i + 1}`}
              aria-pressed={i === selected}
              onClick={() => setSelected(i)}
              className={[s.swatch, i === selected && s.selected].filter(Boolean).join(' ')}
              style={{ background: stripe(pair) }}
            />
          ))}
          <span className={[s.swatch, s.locked].join(' ')}><LockIcon /><span className={s.lockLabel}>LV 45</span></span>
          <span className={[s.swatch, s.locked].join(' ')}><LockIcon /></span>
          <span className={[s.swatch, s.shopOnly].join(' ')}>SHOP<br />ONLY</span>
        </div>

        <div className={s.equipped}>
          <span className={s.equippedText}>
            <span className={s.equippedLabel}>EQUIPPED</span>
            <span className={s.equippedName}>{equipped}</span>
          </span>
          <JellyButton variant="pill" tone="go" centered feel={feel} onClick={onSave}>SAVE</JellyButton>
        </div>
      </Panel>

      <div className={s.foot}>
        <JellyButton variant="pill" tone="glass" centered feel={feel}>NAME CARD</JellyButton>
        <JellyButton variant="pill" tone="glass" centered feel={feel}>VICTORY POSE</JellyButton>
        <JellyButton variant="pill" tone="glass" centered feel={feel} onClick={onShop}>OPEN SHOP</JellyButton>
      </div>
    </Stage>
  );
}
