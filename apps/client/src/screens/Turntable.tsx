import { useEffect, useRef, useState } from "react";
import { CharacterPreview } from "./CharacterPreview.js";
import s from "./CharacterSelect.module.css";

/** How long the emote holds before handing back to idle (ms). */
const EMOTE_HOLD_MS = 1_400;

export interface TurntableProps {
  /** Equipped-color preview — the bean wears `color` the moment it changes, SAVE or not. Shows under no `skin`. */
  color: number;
  /** Skin preview (ADR 0091) — painted on the moment it changes, like `color`. `null` shows the color. */
  skin: string | null;
  /** Hat preview (ADR 0083) — worn the moment it changes, like `color`. */
  hat: string | null;
  /** Increment to spin the bean one full extra turn. */
  spinToken: number;
  /** Increment to play the emote. */
  emoteToken: number;
}

/**
 * The live 3D bean on `/character` (M9 ticket 15) — a `CharacterPreview`
 * idling on a slow turntable, wearing the previewed skin or color. ROTATE spins
 * through the shared stage; PLAY EMOTE briefly swaps the idle for the
 * Wobble clip (the rig ships no dedicated emote clips, so the wiggle
 * doubles as one). No WebGL (or no model) degrades to the caption instead
 * of a dead canvas — which is also what jsdom renders in tests.
 */
export function Turntable({ color, skin, hat, spinToken, emoteToken }: TurntableProps) {
  const [emoting, setEmoting] = useState(false);
  const firstEmote = useRef(true);

  useEffect(() => {
    if (firstEmote.current) {
      firstEmote.current = false;
      return;
    }
    setEmoting(true);
    const timer = setTimeout(() => setEmoting(false), EMOTE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [emoteToken]);

  return (
    <CharacterPreview
      color={color}
      skin={skin}
      hat={hat}
      animation={emoting ? "Wobble" : "Idle"}
      spinToken={spinToken}
      label="LIVE 3D CHARACTER RENDER · TURNTABLE + IDLE"
      sub="EXISTING CHARACTER, EXISTING COSMETICS"
      canvasLabel="3D preview of your bean"
      className={s.stage3d}
    />
  );
}
