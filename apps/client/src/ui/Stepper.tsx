import s from './Stepper.module.css';

export interface StepperProps {
  value: number;
  min?: number | undefined;
  max?: number | undefined;
  /** What is being stepped, for the buttons' accessible names — e.g. "Rounds" reads as "Fewer Rounds". */
  label?: string | undefined;
  onChange?: ((value: number) => void) | undefined;
}

export default function Stepper({ value, min = 1, max = 9, label, onChange }: StepperProps) {
  const name = (word: string): string => (label ? `${word} ${label}` : word);
  return (
    <div className={s.stepper}>
      <button type="button" className={s.btn} aria-label={name('Fewer')} disabled={value <= min} onClick={() => onChange?.(Math.max(min, value - 1))}>
        <svg viewBox="0 0 14 4" aria-hidden="true"><rect width="14" height="4" rx="2" /></svg>
      </button>
      <span className={s.value} data-df-numeric>{value}</span>
      <button type="button" className={[s.btn, s.plus].join(' ')} aria-label={name('More')} disabled={value >= max} onClick={() => onChange?.(Math.min(max, value + 1))}>
        <svg viewBox="0 0 14 14" aria-hidden="true"><rect y="5" width="14" height="4" rx="2" /><rect x="5" width="4" height="14" rx="2" /></svg>
      </button>
    </div>
  );
}
