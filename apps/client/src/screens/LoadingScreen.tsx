import Stage from "../ui/Stage";
import Chip from "../ui/Chip";
import type { ChipTone } from "../ui/Chip";
import Logo from "../ui/Logo";
import { TRACK_ART_LAYER, trackArtStyle } from "../lib/trackArt.js";
import s from "./LoadingScreen.module.css";

export interface LoadingScreenProps {
  /** What the wait is for, in the design's capitals: `CONNECTING TO THE LOBBY…`. */
  label?: string;
}

/**
 * A non-interactive wait: it shows the wait but never times it (M7 ticket 06's
 * principle for Standings). No mock has one, so it is composed from the mocks' own pieces (ADR
 * 0105): the Main Menu's stage and sheen, the Logo, and a glass status chip.
 * Signing in, the session check, connecting to a Lobby, saving and loading
 * results, and counting beans all read the same.
 */
export function LoadingScreen({ label = "LOADING NEXT ROUND…" }: LoadingScreenProps) {
  return (
    <Stage background="var(--df-stage-menu)" sheen="var(--df-sheen-menu)" className={s.wait}>
      <Logo size={5} />
      <StatusChip label={label} />
    </Stage>
  );
}

export interface RoundLoaderProps {
  /** The Track the Round runs on, in capitals. */
  trackName: string;
  /** Its screenshot (ADR 0085), preloaded at sign-in (ADR 0105). Absent: the Lobby's plain stage. */
  thumbnailUrl?: string | undefined;
  /** Which Round this is, and of how many — absent before a Match has counted any. */
  round?: number | undefined;
  rounds?: number | undefined;
  /** The Round type, in capitals (`RACE`, `SURVIVAL`) — absent while the draw keeps it hidden. */
  mode?: string | undefined;
  /** What the Round is waiting on: `LOADING TRACK…`, `WAITING FOR PLAYERS 3/4`. */
  label: string;
}

const MODE_TONE: Record<string, ChipTone> = { RACE: "race", SURVIVAL: "survival" };

/**
 * The Round loader (ADR 0089, 0105): the Track's screenshot as the Stage's
 * own field under the plate scrim, which Round this is, the Track's name at
 * headline size, its mode, and what the Round is still waiting on. It is the
 * next-up card from BetweenRounds, blown up to the whole screen.
 */
export function RoundLoader({ trackName, thumbnailUrl, round, rounds, mode, label }: RoundLoaderProps) {
  return (
    <Stage
      background="var(--df-stage-lobby)"
      field={TRACK_ART_LAYER}
      style={trackArtStyle(thumbnailUrl)}
      sheen="linear-gradient(180deg, rgba(43,27,77,.25) 0%, rgba(43,27,77,.45) 45%, rgba(43,27,77,.85) 100%)"
      className={s.round}
    >
      <header className={s.head}>
        <Logo size={2.65} chrome />
      </header>
      <div className={s.hero}>
        {round !== undefined && rounds !== undefined && (
          <span className={s.kicker}>
            ROUND {round} OF {rounds}
          </span>
        )}
        <h1 className={s.title}>{trackName}</h1>
        {mode !== undefined && (
          <Chip tone={MODE_TONE[mode] ?? "any"} lg>
            {mode}
          </Chip>
        )}
      </div>
      <div className={s.foot}>
        <StatusChip label={label} />
      </div>
    </Stage>
  );
}

function StatusChip({ label }: { label: string }) {
  return (
    <Chip tone="glass" lg dot className={s.status}>
      <span role="status">{label}</span>
    </Chip>
  );
}
