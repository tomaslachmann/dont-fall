import { useEffect, useRef, useState } from "react";
import styles from "./Toggle.module.css";
import { useReducedMotion } from "../../hooks/useReducedMotion";

export interface ToggleProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  /** State label riding beside the thumb — readable without color alone. */
  label?: { on: string; off: string };
  /** Another Player's own row — not interactive for anyone but its owner. */
  readOnly?: boolean;
  "aria-label"?: string;
}

/** `<ReadyToggle>` and any Settings binary switch. */
export function Toggle({
  checked,
  onChange,
  label = { on: "ready", off: "ready?" },
  readOnly = false,
  ...rest
}: ToggleProps) {
  const reducedMotion = useReducedMotion();
  const [snapClass, setSnapClass] = useState<string | null>(null);
  const prevChecked = useRef(checked);

  useEffect(() => {
    if (prevChecked.current !== checked && !reducedMotion) {
      setSnapClass((checked ? styles.snapOn : styles.snapOff) ?? null);
    }
    prevChecked.current = checked;
  }, [checked, reducedMotion]);

  const toggle = () => {
    if (readOnly) return;
    onChange?.(!checked);
  };

  const classes = [styles.toggle, checked && styles.checked, readOnly && styles.readOnly, snapClass]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      role="switch"
      aria-checked={checked}
      aria-readonly={readOnly || undefined}
      tabIndex={readOnly ? -1 : 0}
      onClick={toggle}
      onKeyDown={(e) => {
        if (!readOnly && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          toggle();
        }
      }}
      onAnimationEnd={() => setSnapClass(null)}
      {...rest}
    >
      <span className={styles.thumbLabel}>{checked ? label.on : label.off}</span>
      <div className={styles.thumb} />
    </div>
  );
}
