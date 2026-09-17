import { useEffect, useState } from 'react';
import Stage from '../ui/Stage';
import JellyButton from '../ui/JellyButton';
import Logo from '../ui/Logo';
import Pill from '../ui/Pill';
import type { Feel } from '../tokens';
import s from './ErrorScreen.module.css';

export type ErrorKind = 'connection' | 'crash' | 'kicked';

export interface ErrorScreenProps {
  kind?: ErrorKind;
  /** Support code — the only string a player needs to give us. */
  code?: string;
  /** Overrides the kind's canned detail line — the real error text when there is one. */
  detail?: string;
  /** Seconds until the automatic retry. Set 0 to hide the countdown. */
  retryIn?: number;
  onRetry?: () => void;
  onHome?: () => void;
  feel?: Feel;
}

const COPY: Record<ErrorKind, { tag: string; title: string; body: string; detail: string }> = {
  connection: {
    tag: 'CONNECTION LOST',
    title: 'You dropped out of the race.',
    body: 'We lost the server mid-round. Your progress for this round is gone, your rewards are not.',
    detail: 'ws://eu-west-3.dontfall.gg · closed 1006',
  },
  crash: {
    tag: 'SOMETHING BROKE',
    title: 'The game tripped over itself.',
    body: 'Not your fault, not your connection. We logged it with the code below.',
    detail: 'render loop halted · frame 41 992',
  },
  kicked: {
    tag: 'REMOVED FROM MATCH',
    title: 'The host closed the lobby.',
    body: 'Nothing you did. You can jump straight into a public race instead.',
    detail: 'lobby PLUMJA · host ended session',
  },
};

export default function ErrorScreen({
  kind = 'connection', code = 'DF-7742-QX', detail, retryIn = 5, onRetry, onHome, feel,
}: ErrorScreenProps) {
  const [left, setLeft] = useState(retryIn);
  const [copied, setCopied] = useState(false);
  const c = COPY[kind];

  useEffect(() => {
    setLeft(retryIn);
    if (!retryIn) return;
    const t = setInterval(() => setLeft((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [retryIn, kind]);

  const copy = () => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Stage background="var(--df-stage-tension)" sheen="var(--df-color-scrim)" feel={feel} className={s.screen}>
      <header className={s.head}>
        <Logo size={2.2} chrome />
        <Pill tone="danger">{c.tag}</Pill>
      </header>

      <div className={s.card}>
        <span className={s.alert} aria-hidden="true">
          <svg viewBox="0 0 48 48">
            <circle className={s.alertDisc} cx="24" cy="24" r="20" />
            <rect className={s.alertGlyph} x="21.2" y="11" width="5.6" height="16.4" rx="2.8" />
            <circle className={s.alertGlyph} cx="24" cy="34.6" r="3.1" />
          </svg>
        </span>

        <h1 className={s.title}>{c.title}</h1>
        <p className={s.lede}>{c.body}</p>

        <div className={s.rows}>
          <button type="button" className={s.codeRow} onClick={copy}>
            <span className={s.rowLabel}>SUPPORT CODE</span>
            <code className={s.code}>{code}</code>
            <span className={s.copyHint}>{copied ? 'COPIED' : 'TAP TO COPY'}</span>
          </button>
          <div className={s.detailRow}>
            <span className={s.rowLabel}>DETAIL</span>
            <code className={s.detail}>{detail ?? c.detail}</code>
          </div>
        </div>

        <div className={s.actions}>
          <span className={s.retryNote}>{left > 0 ? `AUTO-RETRY IN ${left}s` : 'READY WHEN YOU ARE'}</span>
          <JellyButton variant="tile" centered onClick={onRetry}>TRY AGAIN</JellyButton>
          <JellyButton variant="tile" tone="glass" centered sound="back" onClick={onHome}>MAIN MENU</JellyButton>
        </div>
      </div>
    </Stage>
  );
}
