import Stage from '../ui/Stage';
import Panel, { PanelHead, Rows, Row } from '../ui/Panel';
import Toggle from '../ui/Toggle';
import JellyButton from '../ui/JellyButton';
import { SCREEN_SHAKE_LEVELS, type GameplaySettings, type ScreenShake } from '../lib/gameplaySettings.js';
import type { Feel } from '../tokens';
import s from './PauseMenu.module.css';

export interface PauseMenuProps {
  settings: GameplaySettings;
  onChange: (settings: GameplaySettings) => void;
  /** Back to the Round — the click that closes the sheet takes the mouse again. */
  onClose: () => void;
  onAllSettings: () => void;
  onQuit: () => void;
  feel?: Feel;
}

/**
 * The in-Round pause sheet (ADR 0110) — the design's SettingsModal, ported:
 * only what you'd change mid-Match, over the live Round (the game never
 * pauses underneath). Its rows are real settings, stored per device and
 * heard by the running game at once. Voice chat joins them when it exists
 * (M15 ticket 17).
 */
export default function PauseMenu({ settings, onChange, onClose, onAllSettings, onQuit, feel }: PauseMenuProps) {
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
          <Row>
            <span className={s.rowText}>
              <span className={s.rowLabel}>SCREEN SHAKE ON IMPACT</span>
              <span className={s.rowSub}>Reduce for motion sensitivity</span>
            </span>
            <Toggle
              options={[...SCREEN_SHAKE_LEVELS]}
              value={settings.screenShake}
              onChange={(value) => onChange({ ...settings, screenShake: value as ScreenShake })}
            />
          </Row>
          <Row>
            <span className={s.rowText}>
              <span className={s.rowLabel}>SHOW OTHER BEANS’ NAMES</span>
              <span className={s.rowSub}>Nameplates during a race</span>
            </span>
            <Toggle
              options={['OFF', 'ON']}
              value={settings.nameplates ? 'ON' : 'OFF'}
              onChange={(value) => onChange({ ...settings, nameplates: value === 'ON' })}
            />
          </Row>
        </Rows>

        <div className={s.foot}>
          <JellyButton variant="pill" tone="glass" centered feel={feel} onClick={onAllSettings}>ALL SETTINGS</JellyButton>
          <JellyButton variant="pill" tone="danger" centered feel={feel} onClick={onQuit}>QUIT MATCH</JellyButton>
        </div>
      </Panel>
    </Stage>
  );
}
