import type { EmoteId } from "@dont-fall/shared";
import { CharacterPreview, emoteOnce } from "./CharacterPreview.js";
import s from "./CharacterSelect.module.css";

export interface TurntableProps {
  /** Equipped-color preview — the bean wears `color` the moment it changes, SAVE or not. Shows under no `skin`. */
  color: number;
  /** Skin preview (ADR 0091) — painted on the moment it changes, like `color`. `null` shows the color. */
  skin: string | null;
  /** Hat preview (ADR 0083) — worn the moment it changes, like `color`. */
  hat: string | null;
  /** Increment to spin the bean one full extra turn. */
  spinToken: number;
  /** Which emote the next `emoteToken` plays (ADR 0110). */
  emote: EmoteId;
  /** Increment to play `emote` once. Zero is "never asked", and the bean idles. */
  emoteToken: number;
}

/**
 * The live 3D bean on `/character` (M9 ticket 15) — a `CharacterPreview`
 * idling on a slow turntable, wearing the previewed skin or color. ROTATE spins
 * through the shared stage; PLAY EMOTE and a VICTORY POSE pick perform that
 * emote once and idle after it (ADR 0110). No WebGL (or no model) degrades to
 * the caption instead of a dead canvas — which is also what jsdom renders in tests.
 */
export function Turntable({ color, skin, hat, spinToken, emote, emoteToken }: TurntableProps) {
  return (
    <CharacterPreview
      color={color}
      skin={skin}
      hat={hat}
      animation={emoteToken === 0 ? "Idle" : emoteOnce(emote)}
      spinToken={spinToken}
      playToken={emoteToken}
      sub="TURNTABLE + IDLE"
      canvasLabel="3D preview of your bean"
      className={s.stage3d}
    />
  );
}
