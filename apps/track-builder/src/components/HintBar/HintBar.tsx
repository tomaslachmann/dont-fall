import css from "./HintBar.module.css";

const HINTS: { key: string; action: string; accent?: boolean }[] = [
  { key: "↑↓←→ PgUp/PgDn", action: "move" },
  { key: "[ ]", action: "rotate on active axis" },
  { key: "− =", action: "size" },
  { key: "SHIFT", action: "fine step everywhere", accent: true },
  { key: "ESC", action: "cancel pivot / respawn pick" },
];

/** The keyboard cheat sheet — captions drop at 1240px, the whole bar at 980px (the design's own tiers). */
export function HintBar() {
  return (
    <div className={css.root}>
      {HINTS.map((h) => (
        <span key={h.key} className={css.pair}>
          <kbd className={[css.key, h.accent ? css.accent : ""].join(" ")}>{h.key}</kbd>
          <span className={css.action}>{h.action}</span>
        </span>
      ))}
    </div>
  );
}
