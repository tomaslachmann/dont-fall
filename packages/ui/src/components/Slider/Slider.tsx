import { useRef, useState } from "react";
import styles from "./Slider.module.css";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  showValue?: boolean;
  "aria-label": string;
}

/** Look sensitivity, all three volumes, Camera shake/FOV — one component. */
export function Slider({ value, onChange, min = 0, max = 100, showValue = true, ...rest }: SliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const setFromClientX = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * (max - min) + min;
    onChange(Math.max(min, Math.min(max, Math.round(pct))));
  };

  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className={[styles.sliderRow, dragging && styles.dragging].filter(Boolean).join(" ")}>
      <div
        ref={trackRef}
        className={styles.track}
        tabIndex={0}
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={(e) => {
          trackRef.current?.setPointerCapture(e.pointerId);
          setDragging(true);
          setFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging) setFromClientX(e.clientX);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            onChange(Math.min(max, value + 1));
            e.preventDefault();
          }
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            onChange(Math.max(min, value - 1));
            e.preventDefault();
          }
        }}
        {...rest}
      >
        <div className={styles.fill} style={{ width: `${pct}%` }} />
        <div className={styles.thumb} style={{ left: `${pct}%` }} />
      </div>
      {showValue && <span className={styles.value}>{value}</span>}
    </div>
  );
}
