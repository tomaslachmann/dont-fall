import { useState } from 'react';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import Logo from '../ui/Logo';
import RenderSlot from '../ui/RenderSlot';
import type { Feel } from '../tokens';
import s from './Auth.module.css';

export type AuthMode = 'login' | 'signup';

export interface AuthValues {
  name: string;
  email: string;
  password: string;
  remember: boolean;
}

export interface AuthProps {
  /** Which tab is open on mount. */
  defaultMode?: AuthMode;
  /** Controlled mode — pair with onMode. */
  mode?: AuthMode;
  onMode?: (mode: AuthMode) => void;
  onSubmit?: (mode: AuthMode, values: AuthValues) => void;
  onForgot?: () => void;
  onProvider?: (provider: string) => void;
  feel?: Feel;
}

const PROVIDERS = ['STEAM', 'CONSOLE', 'GUEST'];

const COPY: Record<AuthMode, { title: string; cta: string; consent: string }> = {
  login:  { title: 'WELCOME BACK, BEAN.', cta: 'JUMP IN', consent: 'KEEP ME LOGGED IN' },
  signup: { title: 'PICK A NAME. START FALLING.', cta: 'CREATE BEAN', consent: 'I’M OK WITH FALLING OVER A LOT' },
};

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6-10-6-10-6z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

export default function Auth({
  defaultMode = 'login', mode: controlled, onMode, onSubmit, onForgot, onProvider, feel,
}: AuthProps) {
  const [uncontrolled, setUncontrolled] = useState<AuthMode>(defaultMode);
  const mode = controlled ?? uncontrolled;

  const [name, setName] = useState('');
  const [email, setEmail] = useState(mode === 'login' ? 'noodlebean@dontfall.gg' : '');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [consent, setConsent] = useState(mode === 'login');

  const copy = COPY[mode];
  const isSignup = mode === 'signup';

  const setMode = (next: AuthMode) => {
    setUncontrolled(next);
    onMode?.(next);
  };

  const submit = () => onSubmit?.(mode, { name, email, password, remember: consent });

  return (
    <Stage
      background="var(--df-stage-menu)"
      sheen="var(--df-sheen-menu)"
      feel={feel}
      className={s.screen}
    >
      <Logo size={2.65} chrome />

      <div className={s.body}>
        <RenderSlot grounded wobble label="3D CHARACTER RENDER" sub="WAVING AT THE PLAYER" className={s.greeter} />

        <Panel className={[s.card, isSignup && s.signup].filter(Boolean).join(' ')}>
          <div className={s.tabs} role="tablist">
            {(['login', 'signup'] as AuthMode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={m === mode}
                onClick={() => setMode(m)}
                className={[s.tab, m === mode && s.tabOn].filter(Boolean).join(' ')}
              >{m === 'login' ? 'LOG IN' : 'SIGN UP'}</button>
            ))}
          </div>

          <h1 className={s.title}>{copy.title}</h1>

          <div className={s.fields}>
            {isSignup && (
              <label className={s.field}>
                <span className={s.fieldText}>
                  <span className={s.fieldLabel}>BEAN NAME</span>
                  <input
                    className={s.input}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="WOBBLETON"
                    autoComplete="username"
                  />
                </span>
              </label>
            )}

            <label className={s.field}>
              <span className={s.fieldText}>
                <span className={s.fieldLabel}>EMAIL</span>
                <input
                  className={s.input}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@dontfall.gg"
                  autoComplete="email"
                />
              </span>
            </label>

            <div className={s.field}>
              <label className={s.fieldText}>
                <span className={s.fieldLabel}>PASSWORD</span>
                <input
                  className={[s.input, !reveal && s.masked].filter(Boolean).join(' ')}
                  type={reveal ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                />
              </label>
              <button
                type="button"
                className={s.reveal}
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? 'Hide password' : 'Show password'}
              ><EyeIcon /></button>
            </div>
          </div>

          <div className={s.meta}>
            <button type="button" className={s.check} onClick={() => setConsent((v) => !v)} aria-pressed={consent}>
              <span className={[s.box, consent && s.boxOn].filter(Boolean).join(' ')}>
                <svg viewBox="0 0 12 10" aria-hidden="true"><path d="M1 5l3.5 3.5L11 1.5" /></svg>
              </span>
              <span>{copy.consent}</span>
            </button>
            {!isSignup && (
              <button type="button" className={s.link} onClick={onForgot}>FORGOT?</button>
            )}
          </div>

          <JellyButton variant="tile" centered feel={feel} onClick={submit}>{copy.cta}</JellyButton>

          <div className={s.divider}>
            <span className={s.rule} />
            <span className={s.or}>OR</span>
            <span className={s.rule} />
          </div>

          <div className={s.providers}>
            {PROVIDERS.map((p) => (
              <button key={p} type="button" className={s.provider} onClick={() => onProvider?.(p)}>{p}</button>
            ))}
          </div>
        </Panel>
      </div>
    </Stage>
  );
}
