import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BINDING_ACTIONS,
  MAX_CONTROLS_PER_ACTION,
  cloneBindings,
  controlLabel,
  DEFAULT_BINDINGS,
  findConflicts,
  isBindableControl,
  isTalkMode,
  isVoiceScope,
  levelForXp,
  TALK_MODES,
  VOICE_SCOPES,
  type BindingAction,
  type KeyBindings,
  type TalkMode,
} from '@dont-fall/shared';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import Slider, { type SliderTone } from '../ui/Slider';
import Toggle from '../ui/Toggle';
import Avatar from '../ui/Avatar';
import s from './Settings.module.css';
import { useAccount } from '../lib/hooks/useAccount';
import { flash } from '../lib/flash.js';
import { logout, removeAvatar, saveBindings, uploadAvatar, type Account } from '../lib/api/auth';
import { avatarLook } from '../lib/avatar.js';
import { DEFAULT_GAMEPLAY_SETTINGS, SCREEN_SHAKE_LEVELS, type ScreenShake } from '../lib/gameplaySettings.js';
import { useGameplaySettings } from '../lib/hooks/useGameplaySettings.js';
import { useVoiceSettings } from '../lib/hooks/useVoiceSettings.js';
import { DEFAULT_VOICE_SETTINGS } from '../lib/voiceSettings.js';
import { AVATAR_ACCEPT, avatarFromFile } from '../lib/avatarImage.js';
import { resolveEffectiveBindings, writeStoredBindings } from '../lib/bindingsStore';
import {
  DEFAULT_GRAPHICS_QUALITY,
  GRAPHICS_QUALITY_LEVELS,
  isGraphicsQuality,
  readGraphicsQuality,
  writeGraphicsQuality,
  type GraphicsQuality,
} from '../lib/graphicsQuality';
import { browserStorage } from '../lib/browserStorage';
import {
  DEFAULT_AUDIO_VOLUMES,
  readAudioVolumes,
  writeAudioVolumes,
  type AudioChannel,
  type AudioVolumes,
} from '../lib/audioSettings';
import { listen } from '../lib/socket/listeners';
import { useNavigate } from 'react-router';

export type SettingsTab = 'AUDIO' | 'GAMEPLAY' | 'VIDEO' | 'CONTROLS' | 'ACCOUNT';

const TABS: SettingsTab[] = ['AUDIO', 'GAMEPLAY', 'VIDEO', 'CONTROLS', 'ACCOUNT'];


/** The AUDIO pane's sliders, in order (ADR 0087, M14 ticket 03; VOICE from ADR 0111). */
const AUDIO_SLIDERS: { channel: AudioChannel; label: string; tone: SliderTone }[] = [
  { channel: "master", label: "MASTER", tone: "brand" },
  { channel: "effects", label: "EFFECTS", tone: "accent" },
  { channel: "environment", label: "ENVIRONMENT", tone: "go" },
  { channel: "music", label: "MUSIC", tone: "danger" },
  { channel: "voice", label: "VOICE", tone: "go" },
];

/**
 * What the VOICE CHAT row says underneath it: how this device talks right
 * now, with the key actually bound to it (ADR 0111). The design's own
 * caption is "Push to talk · V", and it stops being true the moment someone
 * rebinds `talk` or picks open mic — so it is built from both rather than
 * written down.
 */
export const talkCaption = (talkMode: TalkMode, bindings: KeyBindings): string => {
  if (talkMode === "OPEN MIC") return "Open mic · heard whenever you speak";
  const [first] = bindings.talk;
  return first === undefined ? "Push to talk · no key bound" : `Push to talk · ${controlLabel(first, "short")}`;
};

const ACTION_ROWS: { action: BindingAction; name: string }[] = [
  { action: "forward", name: "Move forward" },
  { action: "back", name: "Move back" },
  { action: "left", name: "Move left" },
  { action: "right", name: "Move right" },
  { action: "jump", name: "Jump" },
  { action: "dash", name: "Dash" },
  { action: "hit", name: "Hit" },
  { action: "grab", name: "Grab" },
  { action: "spectateNext", name: "Spectate next" },
  // Not a gameplay action (ADR 0111): it holds Voice chat, and is listened
  // for at the app level rather than sampled into an input. It is here
  // because this pane is where a Player looks for a key, not because the
  // list means one thing.
  { action: "talk", name: "Push to talk" },
];

/**
 * The CONTROLS pane (M9 controls) — one row per action, each control a chip
 * that rebinds on click, `+` adding another (up to shared's cap), `×`
 * unbinding. Capture reads raw `code`/mouse buttons off the window; Escape
 * cancels, browser-reserved keys are refused with a hint. Pure render +
 * capture — the draft and the save live in `Settings` so the footer RESET
 * can reach them.
 */
function ControlsPane({
  bindings,
  ready,
  onCommit,
  onRemove,
}: {
  bindings: KeyBindings;
  /** False while the account is still resolving — rows stay hidden so an edit can't land in the wrong lane. */
  ready: boolean;
  onCommit: (action: BindingAction, index: number, control: string) => void;
  onRemove: (action: BindingAction, index: number) => void;
}) {
  const [capturing, setCapturing] = useState<{ action: BindingAction; index: number } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const conflicts = useMemo(() => findConflicts(bindings), [bindings]);
  const conflictByAction = useMemo(() => {
    const map = new Map<BindingAction, string[]>();
    for (const { actions } of conflicts) {
      for (const action of actions) map.set(action, actions.filter((other) => other !== action));
    }
    return map;
  }, [conflicts]);

  useEffect(() => {
    if (!capturing) return;
    const { action, index } = capturing;
    const onKeyDown: EventListener = (event) => {
      const e = event as KeyboardEvent;
      e.preventDefault();
      if (e.repeat) return;
      if (e.code === "Escape") {
        setCapturing(null);
        setHint(null);
        return;
      }
      if (!isBindableControl(e.code)) {
        setHint(`${e.code} can't drive an action — it's reserved by the browser.`);
        return;
      }
      onCommit(action, index, e.code);
      setCapturing(null);
      setHint(null);
    };
    const onMouseDown: EventListener = (event) => {
      const button = (event as MouseEvent).button;
      if (button < 0 || button > 4) return;
      onCommit(action, index, `Mouse${button}`);
      setCapturing(null);
      setHint(null);
    };
    // One call site per listener (the shared `listen` helper) — a drifted
    // remove fails silently and captures keys for the rest of the session.
    const stops = [listen(window, "keydown", onKeyDown), listen(window, "mousedown", onMouseDown)];
    return () => stops.forEach((stop) => stop());
  }, [capturing, onCommit]);

  // Sanity: the pane renders exactly the actions shared defines — no more, no fewer.
  if (ACTION_ROWS.length !== BINDING_ACTIONS.length) throw new Error("controls rows drifted from shared BINDING_ACTIONS");

  if (!ready) {
    return (
      <div className={s.groups}>
        <div className={s.empty}>LOADING SAVED CONTROLS…</div>
      </div>
    );
  }

  return (
    <div className={s.groups}>
      <div className={s.rows}>
        {ACTION_ROWS.map(({ action, name }) => {
          const controls = bindings[action];
          const capturingRow = capturing?.action === action;
          const conflict = conflictByAction.get(action);
          const sub = capturingRow && (hint ?? "Press a key or mouse button… — Escape cancels")
            || (conflict ? `Conflict · also drives ${conflict.join(", ")}` : null)
            || (controls.length === 0 ? "Unbound" : null);
          return (
            <div className={s.row} key={action}>
              <span className={s.rowText}>
                <span className={s.rowLabel}>{name.toUpperCase()}</span>
                {sub && <span className={conflict && !capturingRow ? s.conflictSub : s.rowSub}>{sub}</span>}
              </span>
              <span className={s.chips}>
                {controls.map((control, index) => {
                  const isCapturing = capturing?.action === action && capturing.index === index;
                  return (
                    <span className={[s.chip, isCapturing ? s.chipCapturing : ""].filter(Boolean).join(" ")} key={index}>
                      <button type="button" className={s.chipLabel} onClick={() => { setCapturing({ action, index }); setHint(null); }}>
                        {isCapturing ? "…" : controlLabel(control)}
                      </button>
                      <button
                        type="button"
                        className={s.chipRemove}
                        aria-label={`unbind ${name} control ${index + 1}`}
                        onClick={() => onRemove(action, index)}
                      >×</button>
                    </span>
                  );
                })}
                {controls.length < MAX_CONTROLS_PER_ACTION && (
                  <button
                    type="button"
                    className={s.chipAdd}
                    aria-label={`add ${name} control`}
                    onClick={() => { setCapturing({ action, index: controls.length }); setHint(null); }}
                  >+</button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Settings → ACCOUNT (ADR 0110): the Player's avatar, with UPLOAD and REMOVE,
 * their name and whether Discord is linked. Composed from the sheet's own row
 * vocabulary; the picture is cropped and scaled in the browser before it goes.
 */
function AccountPane({ account, onChanged }: { account: Account; onChanged: (account: Account) => void }) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (work: () => Promise<Account>, failure: string) => {
    setBusy(true);
    work()
      .then(onChanged)
      .catch((err: unknown) => flash(`${failure}: ${err instanceof Error ? err.message : String(err)}`, 'error'))
      .finally(() => setBusy(false));
  };
  const uploaded = account.avatarUploadedAt !== null;
  return (
    <div className={s.groups}>
      <div className={s.rows}>
        <div className={s.row}>
          <span className={s.rowText}>
            <span className={s.rowLabel}>AVATAR</span>
            <span className={s.rowSub}>
              {uploaded
                ? 'Your picture, shown to everyone you play'
                : account.discordId
                  ? 'Your Discord picture · upload one of your own to change it'
                  : 'Your bean’s colour · upload a picture to change it'}
            </span>
          </span>
          <span className={s.rowControls}>
            <Avatar look={avatarLook(account.id, account.color, account.avatarUploadedAt)} size={4.4} />
            <JellyButton variant="pill" centered disabled={busy} onClick={() => input.current?.click()}>UPLOAD</JellyButton>
            {uploaded && (
              <JellyButton variant="pill" tone="glass" centered disabled={busy} onClick={() => run(removeAvatar, 'Couldn’t remove your picture')}>
                REMOVE
              </JellyButton>
            )}
            <input
              ref={input}
              type="file"
              accept={AVATAR_ACCEPT}
              hidden
              aria-label="Avatar picture"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) run(async () => uploadAvatar(await avatarFromFile(file)), 'Couldn’t upload that picture');
              }}
            />
          </span>
        </div>
        <div className={s.row}>
          <span className={s.rowText}>
            <span className={s.rowLabel}>NAME</span>
            <span className={s.rowSub}>{account.displayName}</span>
          </span>
        </div>
        <div className={s.row}>
          <span className={s.rowText}>
            <span className={s.rowLabel}>DISCORD</span>
            <span className={s.rowSub}>{account.discordId ? 'Linked' : 'Not linked'}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/** What each graphics quality level trades (ADR 0079), under its row. */
const QUALITY_NOTES: Record<GraphicsQuality, string> = {
  high: 'Sharpest picture, soft shadows',
  medium: 'Lighter shadows, a little less sharp',
  low: 'No shadows or clouds, for slower machines',
};

/** 1o — main settings. Full sheet with a sidebar; the in-game version is SettingsModal. */
export interface SettingsProps {
  /**
   * Closes the sheet in place — × and DONE — when it is opened over a Match
   * from the pause sheet's ALL SETTINGS (ADR 0110): leaving the route would
   * leave the Match. Absent, both go to the main menu.
   */
  onClose?: () => void;
}

export default function Settings({ onClose }: SettingsProps = {}) {
  const { account, status } = useAccount();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<SettingsTab>("AUDIO");
  // Sound volumes (ADR 0087): per device, stored as the slider moves, and
  // heard at once by a running game.
  const [audioVolumes, setAudioVolumes] = useState<AudioVolumes>(() => readAudioVolumes(browserStorage()));
  const chooseVolumes = (volumes: AudioVolumes) => {
    setAudioVolumes(volumes);
    writeAudioVolumes(browserStorage(), volumes);
  };
  // Screen shake and nameplates (ADR 0110): per device, heard by a running game at once.
  const [gameplay, setGameplay] = useGameplaySettings();
  // Voice chat's scope and talk mode (ADR 0111) — the same per-device store
  // the pause sheet's VOICE CHAT row writes, so the two never disagree.
  const [voice, setVoice] = useVoiceSettings();
  const close = onClose ?? (() => navigate("/"));
  // Graphics quality (ADR 0079): per device, stored the moment it is picked,
  // read by the game the next time it builds a Stage.
  const [graphicsQuality, setGraphicsQuality] = useState<GraphicsQuality>(() => readGraphicsQuality(browserStorage()));
  const chooseQuality = (level: GraphicsQuality) => {
    setGraphicsQuality(level);
    writeGraphicsQuality(browserStorage(), level);
  };

  // The controls draft, keyed to the account lane: guests edit the guest
  // mirror, authed players their Account — a lane change (login resolving)
  // drops the draft rather than saving one lane's edit into the other.
  const lane = account?.id ?? null;
  const [controlsDraft, setControlsDraft] = useState<KeyBindings | null>(null);
  useEffect(() => setControlsDraft(null), [lane]);
  const effectiveControls = useMemo(
    () => controlsDraft ?? resolveEffectiveBindings(account ?? null),
    [controlsDraft, account],
  );

  function onLogOut() {
    logout();
    navigate("/auth");
  }

  function saveControls(next: KeyBindings) {
    writeStoredBindings(lane, next);
    if (!account) return;
    saveBindings(next)
      .then(() => queryClient.invalidateQueries({ queryKey: ["account"] }))
      .catch((err: unknown) =>
        flash(`Couldn't save controls: ${err instanceof Error ? err.message : String(err)}`, "error"),
      );
  }

  const commitControl = useCallback(
    (action: BindingAction, index: number, control: string) => {
      const controls = [...effectiveControls[action]];
      controls[Math.min(index, controls.length)] = control;
      const next = { ...effectiveControls, [action]: controls };
      setControlsDraft(next);
      saveControls(next);
    },
    // saveControls only touches lane/account/queryClient — stable for a lane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveControls, lane],
  );

  function removeControl(action: BindingAction, index: number) {
    const next = { ...effectiveControls, [action]: effectiveControls[action].filter((_, i) => i !== index) };
    setControlsDraft(next);
    saveControls(next);
  }

  function resetTab() {
    if (tab === "AUDIO") {
      chooseVolumes(DEFAULT_AUDIO_VOLUMES);
      setGameplay({ ...gameplay, screenShake: DEFAULT_GAMEPLAY_SETTINGS.screenShake });
      setVoice(DEFAULT_VOICE_SETTINGS);
    } else if (tab === "GAMEPLAY") {
      setGameplay({ ...gameplay, nameplates: DEFAULT_GAMEPLAY_SETTINGS.nameplates });
    } else if (tab === "VIDEO") {
      chooseQuality(DEFAULT_GRAPHICS_QUALITY);
    } else if (tab === "CONTROLS") {
      const next = cloneBindings(DEFAULT_BINDINGS);
      setControlsDraft(next);
      saveControls(next);
    }
  }

  return (
    <Stage background="var(--df-stage-menu)" sheen="var(--df-color-scrim)" className={s.screen}>
      <Panel className={s.sheet}>
        <div className={s.sidebar}>
          <span className={s.brand}>SETTINGS</span>

          <div className={s.nav} role="tablist">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={t === tab}
                onClick={() => setTab(t)}
                className={[s.tab, t === tab && s.tabOn].filter(Boolean).join(' ')}
              >{t}</button>
            ))}
          </div>

          <button type="button" className={s.logout} onClick={onLogOut}>
            <span className={s.logoutLabel}>LOG OUT</span>
            <span className={s.logoutWho}>{account?.displayName} · LVL {levelForXp(account?.xp ?? 0)}</span>
          </button>
        </div>

        <div className={s.pane}>
          <div className={s.header}>
            <span className={s.paneTitle}>{tab}</span>
            <button type="button" className={s.close} data-ui-sound="back" onClick={close} aria-label="Resume">×</button>
          </div>

          {tab === 'AUDIO' ? (
            <div className={s.groups}>
              <div className={s.sliders}>
                {AUDIO_SLIDERS.map(({ channel, label, tone }) => (
                  <Slider
                    key={channel}
                    label={label}
                    value={audioVolumes[channel]}
                    onChange={(value) => chooseVolumes({ ...audioVolumes, [channel]: value })}
                    tone={tone}
                  />
                ))}
              </div>

              <div className={s.divider} />

              <div className={s.rows}>
                {/* Voice chat (ADR 0111): here on AUDIO, where the design put
                    it, and drawn as the pause sheet's own scope Toggle — a
                    Switch cannot say PARTY or ALL. The same store both read. */}
                <div className={s.row}>
                  <span className={s.rowText}>
                    <span className={s.rowLabel}>VOICE CHAT</span>
                    <span className={s.rowSub}>{talkCaption(voice.talkMode, effectiveControls)}</span>
                  </span>
                  <Toggle
                    options={[...VOICE_SCOPES]}
                    value={voice.scope}
                    onChange={(value) => {
                      if (isVoiceScope(value)) setVoice({ ...voice, scope: value });
                    }}
                  />
                </div>
                <div className={s.row}>
                  <span className={s.rowText}>
                    <span className={s.rowLabel}>TALK</span>
                    <span className={s.rowSub}>Hold a key, or be heard whenever you speak</span>
                  </span>
                  <Toggle
                    options={[...TALK_MODES]}
                    value={voice.talkMode}
                    onChange={(value) => {
                      if (isTalkMode(value)) setVoice({ ...voice, talkMode: value });
                    }}
                  />
                </div>
                <div className={s.row}>
                  <span className={s.rowText}>
                    <span className={s.rowLabel}>SCREEN SHAKE ON IMPACT</span>
                    <span className={s.rowSub}>Reduce for motion sensitivity</span>
                  </span>
                  <Toggle
                    options={[...SCREEN_SHAKE_LEVELS]}
                    value={gameplay.screenShake}
                    onChange={(value) => setGameplay({ ...gameplay, screenShake: value as ScreenShake })}
                  />
                </div>
              </div>
            </div>
          ) : tab === 'VIDEO' ? (
            <div className={s.groups}>
              <div className={s.rows}>
                <div className={s.row}>
                  <span className={s.rowText}>
                    <span className={s.rowLabel}>GRAPHICS QUALITY</span>
                    <span className={s.rowSub}>{QUALITY_NOTES[graphicsQuality]} · applies when the next game starts</span>
                  </span>
                  <Toggle
                    options={GRAPHICS_QUALITY_LEVELS.map((level) => level.toUpperCase())}
                    value={graphicsQuality.toUpperCase()}
                    onChange={(value) => {
                      const level = value.toLowerCase();
                      if (isGraphicsQuality(level)) chooseQuality(level);
                    }}
                  />
                </div>
              </div>
            </div>
          ) : tab === 'CONTROLS' ? (
            <ControlsPane
              bindings={effectiveControls}
              ready={status !== "checking"}
              onCommit={commitControl}
              onRemove={removeControl}
            />
          ) : tab === 'GAMEPLAY' ? (
            <div className={s.groups}>
              <div className={s.rows}>
                <div className={s.row}>
                  <span className={s.rowText}>
                    <span className={s.rowLabel}>SHOW OTHER BEANS’ NAMES</span>
                    <span className={s.rowSub}>Nameplates during a race</span>
                  </span>
                  <Toggle
                    options={['OFF', 'ON']}
                    value={gameplay.nameplates ? 'ON' : 'OFF'}
                    onChange={(value) => setGameplay({ ...gameplay, nameplates: value === 'ON' })}
                  />
                </div>
              </div>
            </div>
          ) : tab === 'ACCOUNT' && account ? (
            <AccountPane
              account={account}
              onChanged={(updated) => queryClient.setQueryData(['account'], updated)}
            />
          ) : (
            <div className={s.groups}>
              <div className={s.empty}>{tab} PANE · SAME ROW VOCABULARY<br />SLIDERS, SWITCHES, SEGMENTED TOGGLES</div>
            </div>
          )}

          <div className={s.foot}>
            <button type="button" className={s.reset} onClick={resetTab}>RESET</button>
            <button type="button" className={s.reset} onClick={() => navigate("/credits")}>CREDITS</button>
            <JellyButton variant="tile" centered sound="confirm" onClick={close}>DONE</JellyButton>
          </div>
        </div>
      </Panel>
    </Stage>
  );
}
