import { useState } from 'react';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import Slider from '../ui/Slider';
import Switch from '../ui/Switch';
import Toggle from '../ui/Toggle';
import s from './Settings.module.css';
import { useAccount } from '../lib/hooks/useAccount';
import { logout } from '../lib/api/auth';
import { useNavigate } from 'react-router';

export type SettingsTab = 'AUDIO' | 'GAMEPLAY' | 'VIDEO' | 'CONTROLS' | 'ACCOUNT';

const TABS: SettingsTab[] = ['AUDIO', 'GAMEPLAY', 'VIDEO', 'CONTROLS', 'ACCOUNT'];

/** 1o — main settings. Full sheet with a sidebar; the in-game version is SettingsModal. */
export default function Settings() {
  const { account } = useAccount();
  const navigate = useNavigate();
  const [tab, setTab] = useState<SettingsTab>("AUDIO");
  const [master, setMaster] = useState(78);
  const [music, setMusic] = useState(42);
  const [impacts, setImpacts] = useState(92);
  const [voice, setVoice] = useState(true);
  const [crowd, setCrowd] = useState(false);
  const [shake, setShake] = useState('LOW');

  function onLogOut() {
    logout();
    navigate("/auth");
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
            <button type="button" className={s.close} onClick={() => navigate("/")} aria-label="Resume">×</button>
          </div>

          {tab === 'AUDIO' ? (
            <div className={s.groups}>
              <div className={s.sliders}>
                <Slider label="MASTER" value={master} onChange={setMaster} tone="brand" />
                <Slider label="MUSIC" value={music} onChange={setMusic} tone="danger" />
                <Slider label="IMPACTS &amp; GRABS" value={impacts} onChange={setImpacts} tone="accent" />
              </div>

              <div className={s.divider} />

              <div className={s.rows}>
                <div className={s.row}>
                  <span className={s.rowText}>
                    <span className={s.rowLabel}>VOICE CHAT</span>
                    <span className={s.rowSub}>Push to talk · V</span>
                  </span>
                  <Switch checked={voice} onChange={setVoice} label="Voice chat" />
                </div>

                <div className={s.row}>
                  <span className={s.rowText}>
                    <span className={s.rowLabel}>CROWD REACTIONS</span>
                    <span className={s.rowSub}>Spectators cheer when you get grabbed</span>
                  </span>
                  <Switch checked={crowd} onChange={setCrowd} label="Crowd reactions" />
                </div>

                <div className={s.row}>
                  <span className={s.rowText}>
                    <span className={s.rowLabel}>SCREEN SHAKE ON IMPACT</span>
                    <span className={s.rowSub}>Reduce for motion sensitivity</span>
                  </span>
                  <Toggle options={['OFF', 'LOW', 'FULL']} value={shake} onChange={setShake} />
                </div>
              </div>
            </div>
          ) : (
            <div className={s.groups}>
              <div className={s.empty}>{tab} PANE · SAME ROW VOCABULARY<br />SLIDERS, SWITCHES, SEGMENTED TOGGLES</div>
            </div>
          )}

          <div className={s.foot}>
            <button type="button" className={s.reset}>RESET</button>
            <JellyButton variant="tile" centered onClick={() => console.log("onclose")}>DONE</JellyButton>
          </div>
        </div>
      </Panel>
    </Stage>
  );
}
