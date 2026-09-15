import { useEffect, useState } from "react";
import css from "./Stepper.module.css";

interface Props {
  value: string;
  /** Shift holds the finer tier — the builder's two-tier step convention. */
  onStep?: (delta: -1 | 1, fine: boolean) => void;
  /** Exact entry (Enter or blur) — the scale clamps itself downstream. */
  onCommit?: (value: number) => void;
}

/** The size stepper. Keeps the kit's press-and-squash feel — it is a real action. */
export function Stepper({ value, onStep, onCommit }: Props) {
  // A draft, not the value: typing must not commit (and re-render the shell)
  // per keystroke, and an outside change (gizmo drag, preset) overwrites it.
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (): void => {
    const parsed = Number.parseFloat(draft);
    if (Number.isFinite(parsed)) onCommit?.(parsed);
    else setDraft(value);
  };
  return (
    <div className={css.root}>
      <button type="button" className={css.btn} aria-label="decrease" title="smaller · Shift for a finer step"
        onClick={(e) => onStep?.(-1, e.shiftKey)}>−</button>
      <input className={css.value} data-df-numeric aria-label="size" title="exact size · Enter commits"
        value={draft} inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value);
            (e.target as HTMLInputElement).blur();
          }
        }} />
      <button type="button" className={css.btn} aria-label="increase" title="bigger · Shift for a finer step"
        onClick={(e) => onStep?.(1, e.shiftKey)}>+</button>
    </div>
  );
}
