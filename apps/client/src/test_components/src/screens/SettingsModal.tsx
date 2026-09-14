import { useState } from 'react';
import Stage from '../ui/Stage';
import Panel, { PanelHead, Rows, Row } from '../ui/Panel';
import Toggle from '../ui/Toggle';
import JellyButton from '../ui/JellyButton';
import type { Feel } from '../tokens';
import s from './SettingsModal.module.css';

interface QuickSetting {
  key: string;
  label: string;
  sub: string;
  options: string[];
  initial: string;
}

/** Only what you'd change mid-match. Everything else lives in the main Settings screen. */
const QUICK: QuickSetting[] = [
  { key: 'shake', label: 'SCREEN SHAKE ON IMPACT', sub: 'Reduce for motion sensitivity', options: ['OFF', 'LOW', 'FULL'], initial: 'FULL' },
  { key: 'voice', label: 'VOICE CHAT', sub: 'Party only, or everyone', options: ['OFF', 'PARTY', 'ALL'], initial: 'PARTY' },
  { key: 'names', label: 'SHOW OTHER BEANS’ NAMES', sub: 'Nameplates during a race', options: ['OFF', 'ON'], initial: 'ON' },
];

export interface SettingsModalProps {
  onClose?: () => void;
  onQuit?: () => void;
  onAllSettings?: () => void;
  feel?: Feel;
}

export default function SettingsModal({ onClose, onQuit, onAllSettings, feel }: SettingsModalProps) {
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(QUICK.map((r) => [r.key, r.initial])),
  );

  return (
    <Stage
      background="var(--df-stage-race)"
      field="var(--df-field-race)"
      sheen="var(--df-color-scrim)"
      feel={feel}
      className={s.screen}
    >
      <Panel modal className={s.card}>
        <PanelHead title="PAUSED">
          <button type="button" className={s.close} onClick={onClose} aria-label="Resume">×</button>
        </PanelHead>

        <Rows>
          {QUICK.map((r) => (
            <Row key={r.key}>
              <span className={s.rowText}>
                <span className={s.rowLabel}>{r.label}</span>
                <span className={s.rowSub}>{r.sub}</span>
              </span>
              <Toggle
                options={r.options}
                value={values[r.key]}
                onChange={(v) => setValues((s2) => ({ ...s2, [r.key]: v }))}
              />
            </Row>
          ))}
        </Rows>

        <div className={s.foot}>
          <JellyButton variant="pill" tone="glass" centered feel={feel} onClick={onAllSettings}>ALL SETTINGS</JellyButton>
          <JellyButton variant="pill" tone="danger" centered feel={feel} onClick={onQuit}>QUIT MATCH</JellyButton>
        </div>
      </Panel>
    </Stage>
  );
}
