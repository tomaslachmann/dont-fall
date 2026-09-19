import { useState } from 'react';
import { BASE_BODY_COLOR_ID, HATS, SKINS } from '@dont-fall/shared';
import { BODY_COLOR_STRIPES as COLORS } from '../lib/bodyColors.js';
import { hatIconUrl } from '../lib/hatAssets.js';
import { skinIconUrl } from '../lib/skinAssets.js';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import type { Feel } from '../tokens';
import { Turntable } from './Turntable';
import s from './CharacterSelect.module.css';

export type CosmeticTab = 'COLOR' | 'SKIN' | 'HAT' | 'EMOTES';

const TABS: CosmeticTab[] = ['COLOR', 'SKIN', 'HAT', 'EMOTES'];

export interface CharacterSelectProps {
  equipped?: string;
  onBack?: () => void;
  onSave?: () => void;
  onShop?: () => void;
  feel?: Feel;
  /** Controlled body-color pick — the Route owns it (it must survive the async account load and reach SAVE). */
  color: number;
  onSelectColor?: (index: number) => void;
  /** Controlled skin pick (ADR 0091), owned by the Route like the color — `null` for none, which shows the color. */
  skin?: string | null;
  onSelectSkin?: (skin: string | null) => void;
  /** Controlled hat pick (ADR 0083), owned by the Route the same way — `null` for none. */
  hat?: string | null;
  onSelectHat?: (hat: string | null) => void;
  /** The Account's level: a skin or hat above it shows locked, with the level it needs. */
  level?: number;
}

const stripe = ([a, b]: readonly [string, string]) =>
  `repeating-linear-gradient(45deg,${a} 0 calc(var(--df-u) * .62),${b} calc(var(--df-u) * .62) calc(var(--df-u) * 1.25))`;

const LockIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
);

/**
 * One unlockable cosmetic's tile: its own icon, pressable when the Account
 * has the level for it and greyed under a lock when it doesn't. Hats and
 * skins are the same tile because they are the same shape of thing — an id,
 * a name, a level and an icon (ADR 0083, 0091).
 */
interface IconTileProps {
  name: string;
  iconUrl: string;
  unlockLevel: number;
  level: number;
  selected: boolean;
  onSelect: () => void;
}

const IconTile = ({ name, iconUrl, unlockLevel, level, selected, onSelect }: IconTileProps) =>
  level >= unlockLevel ? (
    <button
      type="button"
      aria-label={name}
      aria-pressed={selected}
      onClick={onSelect}
      className={[s.swatch, s.iconTile, selected && s.selected].filter(Boolean).join(' ')}
    >
      <img src={iconUrl} alt="" className={s.tileIcon} draggable={false} />
    </button>
  ) : (
    <span title={`${name} unlocks at level ${unlockLevel}`} className={[s.swatch, s.iconTile, s.tileLocked].join(' ')}>
      <img src={iconUrl} alt="" className={s.tileIcon} draggable={false} />
      <LockIcon />
      <span className={s.lockLabel}>LV {unlockLevel}</span>
    </span>
  );

export default function CharacterSelect({
  equipped = 'BUBBLEGUM BEAN', onBack, onSave, onShop, feel, color, onSelectColor,
  skin = null, onSelectSkin, hat = null, onSelectHat, level = 1,
}: CharacterSelectProps) {
  const [tab, setTab] = useState<CosmeticTab>('COLOR');
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
        <Turntable color={color} skin={skin} hat={hat} spinToken={spinToken} emoteToken={emoteToken} />
        <span className={s.shadow} />
        <div className={s.turnActions}>
          <JellyButton variant="pill" tone="glass" centered onClick={() => setSpinToken((t) => t + 1)}>ROTATE</JellyButton>
          <JellyButton variant="pill" centered onClick={() => setEmoteToken((t) => t + 1)}>PLAY EMOTE</JellyButton>
          <JellyButton
            variant="pill"
            tone="glass"
            centered
            onClick={() => {
              // Re-rolls whichever tab you're on, and never the current pick:
              // a randomise that changed nothing would look dead.
              if (tab === 'SKIN') {
                const unlocked = SKINS.filter((def) => level >= def.unlockLevel && def.id !== skin);
                // Nothing unlocked but what's already on: taking it off is still a change.
                onSelectSkin?.(unlocked.length > 0 ? unlocked[Math.floor(Math.random() * unlocked.length)]!.id : null);
                return;
              }
              let next = Math.floor(Math.random() * COLORS.length);
              if (next === color) next = (next + 1) % COLORS.length;
              onSelectColor?.(next);
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
                className={[s.swatch, s.iconTile, hat === null && s.selected].filter(Boolean).join(' ')}
              >NONE</button>
              {HATS.map((def) => (
                <IconTile
                  key={def.id}
                  name={def.name}
                  iconUrl={hatIconUrl(def.id)}
                  unlockLevel={def.unlockLevel}
                  level={level}
                  selected={hat === def.id}
                  onSelect={() => onSelectHat?.(def.id)}
                />
              ))}
            </>
          ) : tab === 'SKIN' ? (
            <>
              <button
                type="button"
                aria-label="No skin"
                aria-pressed={skin === null}
                onClick={() => onSelectSkin?.(null)}
                className={[s.swatch, s.iconTile, skin === null && s.selected].filter(Boolean).join(' ')}
              >NONE</button>
              {SKINS.map((def) => (
                <IconTile
                  key={def.id}
                  name={def.name}
                  iconUrl={skinIconUrl(def.id)}
                  unlockLevel={def.unlockLevel}
                  level={level}
                  selected={skin === def.id}
                  onSelect={() => onSelectSkin?.(def.id)}
                />
              ))}
            </>
          ) : (
          <>
          {COLORS.map((pair, i) => (
            <button
              key={i}
              type="button"
              aria-label={i === BASE_BODY_COLOR_ID ? 'Base' : `Colour ${i + 1}`}
              aria-pressed={i === color}
              onClick={() => onSelectColor?.(i)}
              className={[s.swatch, i === color && s.selected].filter(Boolean).join(' ')}
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
