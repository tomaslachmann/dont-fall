import s from './ReadySwitch.module.css';

export interface ReadySwitchProps {
  ready?: boolean | undefined;
  onChange?: ((ready: boolean) => void) | undefined;
  label?: string | undefined;
  /** e.g. "4 OF 7 READY" */
  tally?: string | undefined;
  /** Second line, accent colored — e.g. "AUTO-START IN 0:14". */
  hint?: string | undefined;
}

export default function ReadySwitch({ ready = true, onChange, label = 'I’M READY', tally, hint }: ReadySwitchProps) {
  return (
    <div className={s.wrap}>
      <button
        type="button"
        role="switch"
        aria-checked={ready}
        onClick={() => onChange?.(!ready)}
        className={[s.switch, !ready && s.off].filter(Boolean).join(' ')}
      >
        <span className={s.track}><span className={s.knob} /></span>
        <span className={s.label}>{label}</span>
      </button>
      {(tally || hint) && (
        <span className={s.tally}>
          {tally}{hint && <><br /><span className={s.hint}>{hint}</span></>}
        </span>
      )}
    </div>
  );
}
