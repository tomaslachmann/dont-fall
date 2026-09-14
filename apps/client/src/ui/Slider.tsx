import type { CSSProperties, ReactNode } from 'react';
import s from './Slider.module.css';

export type SliderTone = 'brand' | 'accent' | 'danger' | 'go' | 'speed';

export interface SliderProps {
  label: ReactNode;
  value: number;
  onChange?: ((value: number) => void) | undefined;
  tone?: SliderTone | undefined;
  min?: number | undefined;
  max?: number | undefined;
}

const TONE: Record<SliderTone, string> = {
  brand: 'var(--df-color-brand)',
  accent: 'var(--df-color-accent)',
  danger: 'var(--df-color-danger)',
  go: 'var(--df-color-go)',
  speed: 'var(--df-color-speed)',
};

export default function Slider({ label, value, onChange, tone = 'brand', min = 0, max = 100 }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className={s.row} style={{ '--df-slider-value': `${pct}%`, '--df-slider-color': TONE[tone] } as CSSProperties}>
      <span className={s.label}>{label}</span>
      <span className={s.control}>
        <span className={s.track}><span className={s.fill} /></span>
        <span className={s.knob} />
        <input
          className={s.input}
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange?.(Number(e.target.value))}
        />
      </span>
      <span className={s.value} data-df-numeric>{value}</span>
    </label>
  );
}
