import { useState } from 'react';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import type { Feel } from '../tokens';
import s from './Login.module.css';

export type AuthMode = 'login' | 'signup';

export interface LoginProps {
  mode?: AuthMode;
  onMode?: (mode: AuthMode) => void;
  onSubmit?: (values: { name: string; password: string }) => void;
  feel?: Feel;
}

const COPY: Record<AuthMode, { title: string; sub: string; cta: string; alt: string }> = {
  login: {
    title: 'WELCOME BACK',
    sub: 'PICK UP WHERE YOU FELL OVER',
    cta: 'LOG IN',
    alt: 'NO ACCOUNT? SIGN UP',
  },
  signup: {
    title: 'NEW BEAN',
    sub: 'PICK A NAME, START FALLING',
    cta: 'CREATE',
    alt: 'ALREADY A BEAN? LOG IN',
  },
};

export default function Login({ mode = 'login', onMode, onSubmit, feel }: LoginProps) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const copy = COPY[mode];

  return (
    <Stage background="var(--df-stage-menu)" sheen="var(--df-sheen-menu)" feel={feel} className={s.screen}>
      <Panel modal className={s.card}>
        <div className={s.head}>
          <span className={s.title}>{copy.title}</span>
          <span className={s.sub}>{copy.sub}</span>
        </div>

        <form
          className={s.form}
          onSubmit={(e) => { e.preventDefault(); onSubmit?.({ name, password }); }}
        >
          <label className={s.field}>
            <span className={s.label}>BEAN NAME</span>
            <input className={s.input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" />
          </label>

          <label className={s.field}>
            <span className={s.label}>PASSWORD</span>
            <input className={s.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>

          <JellyButton variant="tile" centered onClick={() => onSubmit?.({ name, password })}>
            {copy.cta}
          </JellyButton>

          <button type="button" className={s.switch} onClick={() => onMode?.(mode === 'login' ? 'signup' : 'login')}>
            {copy.alt}
          </button>
        </form>
      </Panel>
    </Stage>
  );
}
