import { useState } from 'react';
import Stage from '../ui/Stage';
import JellyButton from '../ui/JellyButton';
import type { Feel } from '../tokens';
import s from './TrackBuilder.module.css';

export interface TrackBuilderProps {
  trackName?: string;
  pieces?: number;
  onPlaytest?: () => void;
  onPublish?: () => void;
  feel?: Feel;
}

/** Obstacle parts, as colored plastic tiles. Real art drops in later. */
const PARTS: Array<[string, string]> = [
  ['SPINNER', '#FFC9E4'],
  ['RAMP', '#BFE9FF'],
  ['PUSHER', '#CFF7C9'],
  ['SLIME', '#E7DDFA'],
  ['FAN', '#FFE3B0'],
  ['GAP', '#FFD1C9'],
  ['BOUNCE', '#D9F0FF'],
  ['GATE', '#F2EDFC'],
  ['GOAL', '#FFF0B8'],
];

const ICONS = {
  paint: <path d="M4 20l7-3 9-9-4-4-9 9z" />,
  move: <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />,
  rotate: <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 3v5h-5" /></>,
  clone: <><rect x="4" y="4" width="10" height="10" rx="2" /><rect x="10" y="10" width="10" height="10" rx="2" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
};

type ToolName = keyof typeof ICONS;
const TOOLS: ToolName[] = ['paint', 'move', 'rotate', 'clone'];

export default function TrackBuilder({
  trackName = 'UNTITLED WOBBLE', pieces = 42, onPlaytest, onPublish, feel,
}: TrackBuilderProps) {
  const [tool, setTool] = useState<ToolName>('paint');
  const [snap, setSnap] = useState(true);

  return (
    <Stage background="var(--df-stage-builder)" feel={feel} className={s.screen} overlay={<div className={s.grid} />}>
      <div className={s.tools}>
        {TOOLS.map((t) => (
          <button
            key={t}
            type="button"
            aria-label={t}
            aria-pressed={t === tool}
            onClick={() => setTool(t)}
            className={[s.tool, t === tool && s.toolOn].filter(Boolean).join(' ')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[t]}</svg>
          </button>
        ))}
        <span className={s.toolRule} />
        <button type="button" className={[s.tool, s.toolDanger].join(' ')} aria-label="Delete">
          <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS.trash}</svg>
        </button>
      </div>

      <div className={s.toolbar}>
        <button type="button" className={s.chip}>UNDO</button>
        <button type="button" className={s.chip}>REDO</button>
        <span className={s.toolbarRule} />
        <button
          type="button"
          aria-pressed={snap}
          onClick={() => setSnap((v) => !v)}
          className={[s.chip, snap && s.chipOn].filter(Boolean).join(' ')}
        >SNAP {snap ? 'ON' : 'OFF'}</button>
        <span className={s.toolbarRule} />
        <span className={s.pieceCount}>{trackName}</span>
      </div>

      <p className={s.viewport}>EXISTING BUILDER VIEWPORT<br />PLAYER’S OWN TRACK</p>

      <div className={s.tray}>
        <span className={s.trayTitle}>PARTS</span>
        <div className={s.parts}>
          {PARTS.map(([label, color]) => (
            <button key={label} type="button" className={s.part} style={{ background: color }}>{label}</button>
          ))}
        </div>
      </div>

      <div className={s.playtest}>
        <JellyButton variant="pill" tone="go" centered feel={feel} onClick={onPlaytest}>PLAYTEST</JellyButton>
        <span className={s.pieceCount}>{pieces} PIECES PLACED</span>
        <JellyButton variant="pill" centered feel={feel} onClick={onPublish}>PUBLISH</JellyButton>
      </div>
    </Stage>
  );
}
