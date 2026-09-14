import type { CSSProperties } from 'react';
import Stage from '../ui/Stage';
import JellyButton from '../ui/JellyButton';
import Logo from '../ui/Logo';
import type { Feel } from '../tokens';
import s from './SystemSheet.module.css';

/** [token, shade token, name, what it means] */
const COLORS: Array<[string, string, string, string]> = [
  ['--df-color-accent', '--df-color-accent-shade', 'ACCENT', 'one primary action per screen'],
  ['--df-color-danger', '--df-color-danger-shade', 'DANGER', 'deficit, being grabbed'],
  ['--df-color-go', '--df-color-go-shade', 'GO', 'confirm, ready, gain'],
  ['--df-color-speed', '--df-color-speed-lite', 'SPEED', 'dash, velocity'],
  ['--df-color-brand', '--df-color-brand-deep', 'BRAND', 'accent text on white'],
  ['--df-color-ink', '--df-color-ink', 'INK', 'all text, darkest plastic'],
];

const BEVELS = ['--df-bevel-2', '--df-bevel-3', '--df-bevel-4', '--df-bevel-5', '--df-bevel-6'];
const RADII = ['--df-radius-chip', '--df-radius-icon', '--df-radius-row', '--df-radius-card', '--df-radius-hero'];

const RULES: Array<[boolean, string]> = [
  [true, 'Bevels are offset shadows with zero blur. Depth scales with importance.'],
  [true, 'Gradients only as full-stage backgrounds — never on a component.'],
  [true, 'Numerals are tabular so timers never jitter.'],
  [false, 'No glass, no blur, no glow. The one blur is the elimination backdrop.'],
  [false, 'Never more than one accent action on a screen.'],
  [false, 'Never a web-style toggle — segmented plastic instead.'],
];

export interface SystemSheetProps { feel?: Feel }

export default function SystemSheet({ feel }: SystemSheetProps) {
  return (
    <Stage background="var(--df-color-surface-3)" feel={feel} className={s.screen}>
      <div className={s.head}>
        <Logo size={2.2} mono />
        <span className={s.title}>SYSTEM SHEET</span>
        <span className={s.sub}>SOLID FILLS · HARD BEVELS · NO GLASS</span>
      </div>

      <div className={s.col}>
        <div className={s.block}>
          <span className={s.blockTitle}>COLOR — SEMANTIC, NOT LITERAL</span>
          <div className={s.swatches}>
            {COLORS.map(([token, shade, name, use]) => (
              <div key={token} className={s.swatch}>
                <span
                  className={s.chipColor}
                  style={{ background: `var(${token})`, '--df-swatch-shade': `var(${shade})` } as CSSProperties}
                />
                <span className={s.swatchName}>{name}</span>
                <span className={s.swatchUse}>{use}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={s.block}>
          <span className={s.blockTitle}>BEVEL LADDER</span>
          <div className={s.bevels}>
            {BEVELS.map((b, i) => (
              <span key={b} className={s.bevelChip} style={{ boxShadow: `0 var(${b}) 0 var(--df-color-accent-shade)` }}>
                {i + 2}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className={s.col}>
        <div className={s.block}>
          <span className={s.blockTitle}>TYPE — TWO FAMILIES ONLY</span>
          <div className={s.typeRow}>
            <span className={s.specimenDisplay}>Wobble 24</span>
            <span className={s.spec}>Fredoka 700</span>
          </div>
          <div className={s.typeRow}>
            <span className={s.specimenLabel}>MASH TO BREAK FREE</span>
            <span className={s.spec}>Nunito 900</span>
          </div>
          <div className={s.typeRow}>
            <span className={s.specimenKicker}>QUICK MATCH · 3 244 ONLINE</span>
            <span className={s.spec}>Nunito 800</span>
          </div>
        </div>

        <div className={s.block}>
          <span className={s.blockTitle}>RADIUS LADDER</span>
          <div className={s.radii}>
            {RADII.map((r) => (
              <span key={r} className={s.radiusChip} style={{ borderRadius: `var(${r})` }} />
            ))}
          </div>
        </div>

        <div className={s.block}>
          <span className={s.blockTitle}>MOTION — TWO PRESS PERSONALITIES</span>
          <div className={s.motion}>
            <div className={s.motionRow}>
              <span className={s.motionName}>SNAPPY</span>
              <span className={s.motionSpec}>70 / 110ms · (.2,.9,.25,1)</span>
            </div>
            <div className={s.motionRow}>
              <span className={s.motionName}>JELLY</span>
              <span className={s.motionSpec}>120 / 260ms · (.34,1.56,.64,1)</span>
            </div>
            <div className={s.motionRow}>
              <span className={s.motionName}>PRESS</span>
              <span className={s.motionSpec}>sink = bevel shrink, same px</span>
            </div>
          </div>
        </div>
      </div>

      <div className={s.col}>
        <div className={s.block}>
          <span className={s.blockTitle}>BUTTONS — ONE COMPONENT, THREE SIZES</span>
          <div className={s.buttons}>
            <JellyButton variant="tile" centered feel={feel}>HERO / TILE</JellyButton>
            <JellyButton variant="pill" tone="go" centered feel={feel}>CONFIRM</JellyButton>
            <JellyButton variant="pill" tone="danger" centered feel={feel}>DESTRUCTIVE</JellyButton>
            <JellyButton variant="pill" tone="glass" centered feel={feel}>SECONDARY</JellyButton>
          </div>
        </div>

        <div className={s.block}>
          <span className={s.blockTitle}>RULES</span>
          <div className={s.rules}>
            {RULES.map(([yes, text]) => (
              <div key={text} className={s.rule}>
                <span className={yes ? s.ruleYes : s.ruleNo}>{yes ? 'DO' : 'NO'}</span>
                <span className={s.ruleText}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Stage>
  );
}
