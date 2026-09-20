import Avatar from '../ui/Avatar';
import type { AvatarLook } from '../lib/avatar.js';
import s from './SpeakingRow.module.css';

/** One bean being heard right now. */
export interface SpeakingBean {
  accountId: string;
  look: AvatarLook;
  /** Their nickname — shown beside a single speaker, dropped once several talk at once. */
  nickname: string;
  /** Whether this is you. Yours reads MIC rather than your own name: it tells you your microphone is live. */
  you: boolean;
}

export interface SpeakingRowProps {
  speaking: readonly SpeakingBean[];
}

/**
 * Who is talking, over the running Round (ADR 0111) — the Survival HUD's
 * avatar row, borrowed, because that is the vocabulary this game already has
 * for "these particular beans, right now".
 *
 * It exists because the nameplate cue cannot be relied on: nameplates are a
 * setting a Player can turn off (ADR 0110), they hide past 40 m, and the bean
 * talking is very often the one behind you. So there is one place on screen
 * that always answers "who said that".
 *
 * Empty when nobody is talking, and it renders nothing at all then — a
 * permanent empty strip would be furniture in the middle of a race.
 */
export default function SpeakingRow({ speaking }: SpeakingRowProps) {
  if (speaking.length === 0) return null;
  const only = speaking.length === 1 ? speaking[0]! : null;
  return (
    <div className={s.row} aria-live="off">
      <span className={s.icon} aria-hidden="true">
        {/* A microphone, at the size the HUD's other glyphs are drawn. */}
        <svg viewBox="0 0 16 16"><path d="M8 1a2.2 2.2 0 0 0-2.2 2.2v4.2a2.2 2.2 0 0 0 4.4 0V3.2A2.2 2.2 0 0 0 8 1Zm-4.4 6.1a.8.8 0 0 0-1.6 0 6 6 0 0 0 5.2 5.94V15h1.6v-1.96A6 6 0 0 0 14 7.1a.8.8 0 0 0-1.6 0 4.4 4.4 0 0 1-8.8 0Z" /></svg>
      </span>
      <span className={s.beans}>
        {speaking.map((bean) => (
          <Avatar key={bean.accountId} look={bean.look} size={2.6} speaking />
        ))}
      </span>
      {/* One name fits and helps; five would be a wall of text mid-Round. */}
      {only !== null && <span className={s.name}>{only.you ? 'MIC' : only.nickname.toUpperCase()}</span>}
    </div>
  );
}
