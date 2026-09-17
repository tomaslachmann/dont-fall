import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BINDING_ACTIONS,
  MAX_CONTROLS_PER_ACTION,
  cloneBindings,
  controlLabel,
  DEFAULT_BINDINGS,
  findConflicts,
  isBindableControl,
  type BindingAction,
  type KeyBindings,
} from '@dont-fall/shared';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import Slider, { type SliderTone } from '../ui/Slider';
import Toggle from '../ui/Toggle';
import s from './Settings.module.css';
import { useAccount } from '../lib/hooks/useAccount';
import { flash } from '../lib/flash.js';
import { logout, saveBindings } from '../lib/api/auth';
import { resolveEffectiveBindings, writeStoredBindings } from '../lib/bindingsStore';
import {
  DEFAULT_GRAPHICS_QUALITY,
  GRAPHICS_QUALITY_LEVELS,
  isGraphicsQuality,
  readGraphicsQuality,
  writeGraphicsQuality,
  type GraphicsQuality,
} from '../lib/graphicsQuality';
import { browserStorage } from '../lib/perfFlag';
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

const DEFAULT_SHAKE = 'LOW';

/** The AUDIO pane's sliders, in order (ADR 0087, M14 ticket 03). */
const AUDIO_SLIDERS: { channel: AudioChannel; label: string; tone: SliderTone }[] = [
  { channel: "master", label: "MASTER", tone: "brand" },
  { channel: "effects", label: "EFFECTS", tone: "accent" },
  { channel: "environment", label: "ENVIRONMENT", tone: "go" },
  { channel: "music", label: "MUSIC", tone: "danger" },
];

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

/** What each graphics quality level trades (ADR 0079), under its row. */
const QUALITY_NOTES: Record<GraphicsQuality, string> = {
  high: 'Sharpest picture, soft shadows',
  medium: 'Lighter shadows, a little less sharp',
  low: 'No shadows or clouds, for slower machines',
};

/** 1o — main settings. Full sheet with a sidebar; the in-game version is SettingsModal. */
export default function Settings() {
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
  const [shake, setShake] = useState(DEFAULT_SHAKE);
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
      setShake(DEFAULT_SHAKE);
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
            <span className={s.logoutWho}>{account?.displayName} · LVL {42}</span>
          </button>
        </div>

        <div className={s.pane}>
          <div className={s.header}>
            <span className={s.paneTitle}>{tab}</span>
            <button type="button" className={s.close} data-ui-sound="back" onClick={() => navigate("/")} aria-label="Resume">×</button>
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
                <div className={s.row}>
                  <span className={s.rowText}>
                    <span className={s.rowLabel}>SCREEN SHAKE ON IMPACT</span>
                    <span className={s.rowSub}>Reduce for motion sensitivity</span>
                  </span>
                  <Toggle options={['OFF', 'LOW', 'FULL']} value={shake} onChange={setShake} />
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
          ) : (
            <div className={s.groups}>
              <div className={s.empty}>{tab} PANE · SAME ROW VOCABULARY<br />SLIDERS, SWITCHES, SEGMENTED TOGGLES</div>
            </div>
          )}

          <div className={s.foot}>
            <button type="button" className={s.reset} onClick={resetTab}>RESET</button>
            <button type="button" className={s.reset} onClick={() => navigate("/credits")}>CREDITS</button>
            <JellyButton variant="tile" centered sound="confirm" onClick={() => console.log("onclose")}>DONE</JellyButton>
          </div>
        </div>
      </Panel>
    </Stage>
  );
}
