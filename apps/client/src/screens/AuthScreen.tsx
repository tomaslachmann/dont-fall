import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { discordAuthorizeUrl, login, signup } from '../lib/api/auth.js';
import { ApiError, setStoredToken } from '../lib/api/base.js';
import s from './AuthScreen.module.css';
import Stage from '../ui/Stage.js';
import Logo from '../ui/Logo.js';
import { BASE_BODY_SKIN_ID } from '@dont-fall/shared';
import { CharacterPreview } from './CharacterPreview.js';
import Panel from '../ui/Panel.js';
import JellyButton from '../ui/JellyButton.js';

export type AuthMode = 'login' | 'signup';

const PROVIDERS = ['DISCORD'];

const ERROR_MESSAGES: Record<string, string> = {
  'discord-already-linked': 'That Discord account is already linked to a different Account.',
};

const COPY: Record<AuthMode, { title: string; cta: string; consent: string }> = {
  login: { title: 'WELCOME BACK, BEAN.', cta: 'JUMP IN', consent: 'KEEP ME LOGGED IN' },
  signup: { title: 'PICK A NAME. START FALLING.', cta: 'CREATE BEAN', consent: 'I’M OK WITH FALLING OVER A LOT' },
};

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6-10-6-10-6z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

/**
 * `/auth` — Discord OAuth + email/password (ADR 0052/0053). Ported from
 * `apps/client/src/test_components/src/screens/Auth.tsx` verbatim
 * (structure, `authUi/*` components, `Auth.module.css`) with only the
 * design tokens re-scoped (`authUi/tokens.css`, `.authTheme` instead of
 * `:root` — the mock's token system is otherwise untouched, just no longer
 * global) and the content trimmed to decided scope: `PROVIDERS` is
 * `['DISCORD']`, not `['STEAM','CONSOLE','GUEST']` (never decided), and
 * `onSubmit`/`onProvider`/`onForgot` are wired to the real
 * `lib/auth.ts`/the API calls instead of mock callback props.
 * Password reset has no real flow yet (ADR 0053: deferred, needs an email
 * provider decision) — FORGOT? says so rather than pretending to work.
 */
export function AuthScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const callbackError = searchParams.get('error');

  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [consent, setConsent] = useState(mode === 'login');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = COPY[mode];
  const isSignup = mode === 'signup';
  const queryClient = useQueryClient();

  const setModeAndClear = (next: AuthMode) => {
    setMode(next);
    setError(null);
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = mode === 'login' ? await login({ email, password }) : await signup({ email, password, displayName: name });
      setStoredToken(result.token);
      // The gate's ["account"] answer (unauthenticated) is cached — drop it
      // outright so the authed tree resolves the fresh token, remount or not.
      await queryClient.invalidateQueries({ queryKey: ["account"] });
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const onProvider = (provider: string) => {
    if (provider === 'DISCORD') window.location.href = discordAuthorizeUrl();
  };

  const onForgot = () => {
    // No password-reset flow yet (ADR 0053) — deferred, needs a transactional-email
    // provider decision first. Honest about that rather than a dead link.
    setError("Password reset isn't available yet.");
  };

  return (
    <Stage
      background="var(--df-stage-menu)"
      sheen="var(--df-sheen-menu)"
      stageClassName="authTheme"
      className={s.screen ?? ''}
    >
      <Logo size={2.65} chrome />

      <div className={s.body}>
        <CharacterPreview
          skin={BASE_BODY_SKIN_ID}
          animation={[{ clip: "Idle", seconds: 4 }, { clip: "Wobble", seconds: 3.2 }]}
          autoRotate={false}
          label="3D CHARACTER RENDER"
          sub="SAYING HELLO"
          canvasLabel="3D bean greeting you"
          className={s.greeter}
        />
        {/* No wave clip is authored yet — the greeter wiggles hello until one lands. */}

        <Panel className={[s.card, isSignup && s.signup].filter(Boolean).join(' ')}>
          <div className={s.tabs} role="tablist">
            {(['login', 'signup'] as AuthMode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={m === mode}
                onClick={() => setModeAndClear(m)}
                className={[s.tab, m === mode && s.tabOn].filter(Boolean).join(' ')}
              >{m === 'login' ? 'LOG IN' : 'SIGN UP'}</button>
            ))}
          </div>

          <h1 className={s.title}>{copy.title}</h1>

          {(callbackError || error) && (
            <p className={s.errorBanner} role="alert">
              {ERROR_MESSAGES[callbackError ?? ''] ?? error ?? 'Something went wrong — try again.'}
            </p>
          )}

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

          <JellyButton variant="tile" centered sound="confirm" onClick={submit} disabled={submitting}>{copy.cta}</JellyButton>

          <div className={s.divider}>
            <span className={s.rule} />
            <span className={s.or}>OR</span>
            <span className={s.rule} />
          </div>

          <div className={s.providers}>
            {PROVIDERS.map((p) => (
              <button key={p} type="button" className={s.provider} onClick={() => onProvider(p)}>{p}</button>
            ))}
          </div>
        </Panel>
      </div>
    </Stage>
  );
}
