import s from './Switch.module.css';

export interface SwitchProps {
  checked?: boolean | undefined;
  onChange?: ((checked: boolean) => void) | undefined;
  label?: string | undefined;
}

export default function Switch({ checked = false, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange?.(!checked)}
      className={[s.switch, checked && s.on].filter(Boolean).join(' ')}
    >
      <span className={s.knob} />
    </button>
  );
}
