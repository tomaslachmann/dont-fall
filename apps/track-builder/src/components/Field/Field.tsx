import css from './Field.module.css';

interface Props {
  label?: string;
  value: string | number;
  /** numeric fields use the display face + tabular numerals */
  variant?: 'numeric' | 'text' | 'select';
  /** greys the value to 45% and drops the bevel — never hidden */
  disabled?: boolean;
  width?: number | string;
  type?: string;
  min?: number;
  max?: number;
  step?: number | string;
  placeholder?: string;
  title?: string;
  onChange?: (value: string) => void;
}

export function Field({ label, value, variant = 'numeric', disabled, width, type, min, max, step, placeholder, title, onChange }: Props) {
  return (
    <label className={css.wrap} style={{ width }} title={title}>
      {label && <span className={css.label}>{label}</span>}
      <span className={[css.box, css[variant], disabled ? css.disabled : ''].join(' ')}>
        <input className={css.input} value={value} disabled={disabled} data-df-numeric={variant === 'numeric' || undefined}
          type={type} min={min} max={max} step={step} placeholder={placeholder}
          onChange={(e) => onChange?.(e.target.value)} readOnly={!onChange} />
        {variant === 'select' && <span className={css.caret}>⌄</span>}
      </span>
    </label>
  );
}
