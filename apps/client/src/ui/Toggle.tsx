import s from './Toggle.module.css';

export interface ToggleProps {
  /** 2-3 short uppercase options. */
  options?: string[] | undefined;
  value?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
}

export default function Toggle({ options = ['OFF', 'ON'], value, onChange }: ToggleProps) {
  return (
    <div className={s.group} role="group">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={o === value}
          onClick={() => onChange?.(o)}
          className={[s.opt, o === value && s.on].filter(Boolean).join(' ')}
        >{o}</button>
      ))}
    </div>
  );
}
