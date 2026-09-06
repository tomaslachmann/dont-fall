import { useRef, useState } from "react";
import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";
import { useReducedMotion } from "../../hooks/useReducedMotion";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
}

/** `<PrimaryButton>` / `<SecondaryButton>` — see design-system.md §2.1. */
export function Button({
  variant = "primary",
  className,
  disabled,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onKeyDown,
  onKeyUp,
  ...rest
}: ButtonProps) {
  const reducedMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout>>();

  const press = () => {
    if (disabled || reducedMotion) return;
    clearTimeout(releaseTimer.current);
    setReleasing(false);
    setPressed(true);
  };
  const release = () => {
    if (!pressed) return;
    setPressed(false);
    setReleasing(true);
    releaseTimer.current = setTimeout(() => setReleasing(false), 170);
  };

  const classes = [styles.btn, styles[variant], pressed && styles.pressed, releasing && styles.releasing, className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      className={classes}
      disabled={disabled}
      onPointerDown={(e) => {
        press();
        onPointerDown?.(e);
      }}
      onPointerUp={(e) => {
        release();
        onPointerUp?.(e);
      }}
      onPointerLeave={(e) => {
        release();
        onPointerLeave?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") press();
        onKeyDown?.(e);
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") release();
        onKeyUp?.(e);
      }}
      {...rest}
    />
  );
}
