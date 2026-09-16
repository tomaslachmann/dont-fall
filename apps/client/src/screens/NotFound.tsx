import Stage from '../ui/Stage';
import JellyButton from '../ui/JellyButton';
import Logo from '../ui/Logo';
import { BASE_BODY_SKIN_ID } from '@dont-fall/shared';
import { CharacterPreview, SHRUG_SEQUENCE } from './CharacterPreview.js';
import Pill from '../ui/Pill';
import type { Feel } from '../tokens';
import s from './NotFound.module.css';

export interface NotFoundProps {
  /** What the player tried to reach — shown verbatim so support can read it back. */
  path?: string;
  onHome?: () => void;
  onDiscover?: () => void;
  feel?: Feel;
}

export default function NotFound({
  path = '/track/plum-canyon-v3', onHome, onDiscover, feel,
}: NotFoundProps) {
  return (
    <Stage background="var(--df-stage-menu)" sheen="var(--df-color-scrim)" feel={feel} className={s.screen}>
      <header className={s.head}>
        <Logo size={2.2} chrome />
        <Pill>404 · NOT FOUND</Pill>
      </header>

      <div className={s.split}>
        <div className={s.card}>
          <span className={s.code}>404</span>
          <h1 className={s.title}>This track fell off the map.</h1>
          <p className={s.lede}>
            It was deleted, renamed, or never existed. Either way, nobody’s racing on it.
          </p>
          <div className={s.pathRow}>
            <span className={s.pathLabel}>YOU ASKED FOR</span>
            <code className={s.path}>{path}</code>
          </div>
          <div className={s.actions}>
            <JellyButton variant="tile" centered onClick={onHome}>MAIN MENU</JellyButton>
            <JellyButton variant="tile" tone="glass" centered onClick={onDiscover}>
              BROWSE DISCOVER
            </JellyButton>
          </div>
        </div>

        <CharacterPreview
          skin={BASE_BODY_SKIN_ID}
          animation={SHRUG_SEQUENCE}
          autoRotate={false}
          sub="SHRUG POSE"
          canvasLabel="3D bean shrugging at a missing page"
          className={s.art}
        />
        {/* No look-over-the-edge clip exists — a shrug fits a missing page better anyway. */}
      </div>
    </Stage>
  );
}
