import { VOICE_SCOPES, type VoiceScope } from '@dont-fall/shared';
import Stage from '../ui/Stage';
import Panel, { PanelHead, Rows, Row } from '../ui/Panel';
import Toggle from '../ui/Toggle';
import Switch from '../ui/Switch';
import Avatar from '../ui/Avatar';
import Chip from '../ui/Chip';
import JellyButton from '../ui/JellyButton';
import type { AvatarLook } from '../lib/avatar.js';
import { SCREEN_SHAKE_LEVELS, type GameplaySettings, type ScreenShake } from '../lib/gameplaySettings.js';
import s from './PauseMenu.module.css';

/** One Player this Player is linked to by Voice chat — a row with a Mute on it. */
export interface PauseVoicePeer {
  accountId: string;
  nickname: string;
  look: AvatarLook;
  speaking: boolean;
  muted: boolean;
}

export interface PauseVoice {
  /** This device's scope — the same store Settings → AUDIO writes. */
  scope: VoiceScope;
  onScope: (scope: VoiceScope) => void;
  /** Everyone the relay says this Player is linked to, Mutes already applied to hearing. */
  peers: PauseVoicePeer[];
  onMute: (accountId: string, muted: boolean) => void;
  /** Why there is nobody to show, when there is nobody — a line rather than an empty space. */
  emptyReason: string;
}

export interface PauseMenuProps {
  settings: GameplaySettings;
  onChange: (settings: GameplaySettings) => void;
  /** Back to the Round — the click that closes the sheet takes the mouse again. */
  onClose: () => void;
  onAllSettings: () => void;
  /**
   * Leaves the Match. Absent on the Lobby and Standings Screens (ADR 0111),
   * where the sheet also opens but there is no Round to walk out of — those
   * have their own way out on the Screen behind it.
   */
  onQuit?: () => void;
  /**
   * Voice chat's rows (ADR 0111) — the scope, and one Mute per linked Player.
   * Absent where there is no voice at all (a Playtest, free roam), and the
   * rows simply do not appear.
   */
  voice?: PauseVoice;
}

/**
 * The pause sheet (ADR 0110) — the design's SettingsModal, ported: only what
 * you'd change mid-Match, over the live Round (the game never pauses
 * underneath). Its rows are real settings, stored per device and heard by the
 * running game at once.
 *
 * It opens on the Lobby and Standings Screens too (ADR 0111), in place, so
 * Voice chat and Mutes are reachable while the socket stays up — leaving for
 * `/settings` never is the way, since it would leave the Lobby.
 */
export default function PauseMenu({ settings, onChange, onClose, onAllSettings, onQuit, voice }: PauseMenuProps) {
  return (
    <Stage
      background="var(--df-stage-race)"
      field="var(--df-field-race)"
      sheen="var(--df-color-scrim)"

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
          {voice && (
            <Row>
              <span className={s.rowText}>
                <span className={s.rowLabel}>VOICE CHAT</span>
                <span className={s.rowSub}>Party only, or everyone</span>
              </span>
              <Toggle
                options={[...VOICE_SCOPES]}
                value={voice.scope}
                onChange={(value) => onScopePicked(voice, value)}
              />
            </Row>
          )}
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

        {/* One Mute per linked Player (ADR 0111). A Mute is one-way and about
            hearing only: it stops you hearing them, never them hearing you —
            silencing both ways is what OFF above is for. */}
        {voice && (
          <div className={s.voice}>
            <span className={s.voiceHead}>WHO YOU CAN HEAR</span>
            {voice.peers.length === 0 ? (
              <span className={s.voiceEmpty}>{voice.emptyReason}</span>
            ) : (
              <Rows>
                {voice.peers.map((peer) => (
                  <Row key={peer.accountId}>
                    <span className={s.peer}>
                      <Avatar look={peer.look} size={3} speaking={peer.speaking} />
                      <span className={s.rowText}>
                        <span className={s.rowLabel}>{peer.nickname.toUpperCase()}</span>
                        {peer.muted && <span className={s.rowSub}>You can’t hear them</span>}
                      </span>
                      {peer.muted && <Chip tone="plate">MUTED</Chip>}
                    </span>
                    <Switch
                      checked={!peer.muted}
                      label={`Hear ${peer.nickname}`}
                      onChange={(hear) => voice.onMute(peer.accountId, !hear)}
                    />
                  </Row>
                ))}
              </Rows>
            )}
          </div>
        )}

        <div className={s.foot}>
          <JellyButton variant="pill" tone="glass" centered onClick={onAllSettings}>ALL SETTINGS</JellyButton>
          {onQuit && <JellyButton variant="pill" tone="danger" centered onClick={onQuit}>QUIT MATCH</JellyButton>}
        </div>
      </Panel>
    </Stage>
  );
}

/** The Toggle hands back a plain string; only one of the three is a scope. */
const onScopePicked = (voice: PauseVoice, value: string): void => {
  if ((VOICE_SCOPES as readonly string[]).includes(value)) voice.onScope(value as VoiceScope);
};
