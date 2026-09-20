import { useEffect, useRef, useState } from "react";
import type { EmoteId } from "@dont-fall/shared";
import type { CharacterPreviewStage, PreviewBean, PreviewStep } from "../render/characterPreviewStage.js";
import RenderSlot from "../ui/RenderSlot.js";
import s from "./CharacterPreview.module.css";

export type { PreviewBean, PreviewStep } from "../render/characterPreviewStage.js";

/** What the preview performs: one clip looped forever, or a list looped as a sequence. */
export type PreviewAnimation = string | PreviewStep[];

/**
 * The authored beats, shared by every screen that stages them — the
 * Win/Sulk/Shrug clips come as In/Hold/Out (or Start/Loop/End) triplets and
 * only read as a performance when played as one. Hold lengths are whole loop
 * counts off the real clip durations (`Win_Loop`/`Shrug_Hold` 1.6 s,
 * `Sulk_Hold` 2.0 s), so a hold never cuts its own clip mid-beat.
 */
export const WIN_SEQUENCE: PreviewStep[] = [{ clip: "Win_Start" }, { clip: "Win_Loop", seconds: 3.2 }, { clip: "Win_End" }];
export const SULK_SEQUENCE: PreviewStep[] = [{ clip: "Sulk_In" }, { clip: "Sulk_Hold", seconds: 4 }, { clip: "Sulk_Out" }];
export const SHRUG_SEQUENCE: PreviewStep[] = [{ clip: "Shrug_In" }, { clip: "Shrug_Hold", seconds: 3.2 }, { clip: "Shrug_Out" }];

/** The breath after a one-clip emote, so a looped Punch reads as a pose and not as shadowboxing. */
const ONE_CLIP_REST: PreviewStep = { clip: "Idle", seconds: 1.6 };

/**
 * What each emote performs (ADR 0110) — the authored triplets above, or one
 * clip played once and rested after. The set is the rig's, so every clip
 * named here is one `BLIP.glb` ships.
 */
export const EMOTE_SEQUENCES: Record<EmoteId, PreviewStep[]> = {
  win: WIN_SEQUENCE,
  shrug: SHRUG_SEQUENCE,
  sulk: SULK_SEQUENCE,
  wobble: [{ clip: "Wobble" }, ONE_CLIP_REST],
  punch: [{ clip: "Punch" }, ONE_CLIP_REST],
};

/** Longer than anyone watches a turntable: an emote played once idles here until it is asked for again. */
const IDLE_UNTIL_ASKED: PreviewStep = { clip: "Idle", seconds: 3_600 };

/** An emote performed once, then idling — what PLAY EMOTE and a VICTORY POSE pick show. */
export const emoteOnce = (id: EmoteId): PreviewStep[] => [...EMOTE_SEQUENCES[id], IDLE_UNTIL_ASKED];

export interface CharacterPreviewProps {
  /** Equipped body color — or null for the default, when nobody's color is known. Shows under no `skin`. */
  color: number | null;
  /** Equipped skin (ADR 0091) — null or left out for none, which shows the `color`. */
  skin?: string | null | undefined;
  /** Equipped hat (ADR 0083) — null or left out for none. */
  hat?: string | null | undefined;
  animation: PreviewAnimation;
  /** Slow idle rotation. On unless the screen stages the bean deliberately still. */
  autoRotate?: boolean | undefined;
  /** Increment to spin the bean one full extra turn. */
  spinToken?: number | undefined;
  /** Increment to play the sequence again from its first step — the same emote asked for twice. */
  playToken?: number | undefined;
  /**
   * The rest of your Party (ADR 0112), idling beside the bean in their own
   * looks, host first — the main menu's hero. Left out everywhere else.
   */
  party?: PreviewBean[] | undefined;
  /**
   * Fallback caption (no WebGL, no model) — the RenderSlot treatment. It says
   * what is true there: no preview (ADR 0110); `sub` names what the bean
   * would be doing.
   */
  label?: string | undefined;
  sub?: string | undefined;
  canvasLabel?: string | undefined;
  className?: string | undefined;
}

/** No Party beside the bean — every screen but the main menu. */
const NO_COMPANIONS: PreviewBean[] = [];

let webglSupport: boolean | undefined;

/**
 * Whether this browser can create a WebGL2 context at all (what three.js
 * needs) — asked once, on a throwaway canvas, so a screen without one shows
 * its caption at first paint instead of loading the stage to find out.
 */
const webglAvailable = (): boolean => {
  if (webglSupport === undefined) {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      webglSupport = Boolean(gl);
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
};

/**
 * The live 3D bean every screen rents (M9): the same BLIP rig the match
 * renders, wearing a skin or a color, performing one looping clip or a
 * looping sequence. CharacterSelect's turntable, the MainMenu hero, the
 * MatchOver podium, the Rewards celebration and the Auth/NotFound greeters
 * are all this component with different props — the stage (renderer, lights,
 * camera fit, body, hat, teardown) exists exactly once, in
 * `render/characterPreviewStage`.
 *
 * That stage is loaded with a dynamic `import()` (ADR 0008): these screens
 * are the menu bundle, which must not carry three.js or the rig loader.
 */
export function CharacterPreview({
  color,
  skin = null,
  hat = null,
  animation,
  autoRotate = true,
  spinToken = 0,
  playToken = 0,
  party = NO_COMPANIONS,
  label = "NO 3D PREVIEW",
  sub,
  canvasLabel = "3D character preview",
  className,
}: CharacterPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState(webglAvailable);
  const stageRef = useRef<CharacterPreviewStage | null>(null);
  // Screens pass sequence literals inline — a new array identity every
  // render. The player restarts on the serialized steps, never the reference,
  // or the podium would restart its celebration every frame.
  const steps: PreviewStep[] = typeof animation === "string" ? [{ clip: animation }] : animation;
  const stepsKey = JSON.stringify(steps);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const colorRef = useRef(color);
  colorRef.current = color;
  const skinRef = useRef(skin);
  skinRef.current = skin;
  const hatRef = useRef(hat);
  hatRef.current = hat;
  // Keyed like the steps: the menu builds its Party list fresh every render.
  const partyKey = JSON.stringify(party);
  const partyRef = useRef(party);
  partyRef.current = party;
  const firstSpin = useRef(true);
  const firstPlay = useRef(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let cancelled = false;
    let stage: CharacterPreviewStage | null = null;
    import("../render/characterPreviewStage.js").then(
      ({ mountCharacterPreview }) => {
        if (cancelled) return;
        try {
          stage = mountCharacterPreview(canvas, wrap, {
            color: colorRef.current,
            skin: skinRef.current,
            hat: hatRef.current,
            autoRotate,
            steps: () => stepsRef.current,
            companions: partyRef.current,
            onUnavailable: () => {
              if (!cancelled) setAvailable(false);
            },
          });
        } catch {
          // Blocked GPU, WebGL lost since the probe — the RenderSlot below says what this is.
          setAvailable(false);
          return;
        }
        stageRef.current = stage;
      },
      () => {
        if (!cancelled) setAvailable(false);
      },
    );
    return () => {
      cancelled = true;
      stageRef.current = null;
      stage?.dispose();
    };
    // stepsKey intentionally excluded: a new sequence restarts the player
    // through the animation effect below, never through a stage rebuild.
  }, []);

  useEffect(() => {
    stageRef.current?.setLook(color, skin);
  }, [color, skin]);

  useEffect(() => {
    stageRef.current?.setHat(hat);
  }, [hat]);

  useEffect(() => {
    stageRef.current?.setCompanions(partyRef.current);
    // The key IS the dependency — see the note where it is built.
  }, [partyKey]);

  // A new sequence restarts the player from its first step.
  useEffect(() => {
    stageRef.current?.restart();
    // The key IS the dependency — see the note where it is built.
  }, [stepsKey]);

  useEffect(() => {
    if (firstSpin.current) {
      firstSpin.current = false;
      return;
    }
    stageRef.current?.spin();
  }, [spinToken]);

  useEffect(() => {
    if (firstPlay.current) {
      firstPlay.current = false;
      return;
    }
    stageRef.current?.restart();
  }, [playToken]);

  return (
    <div ref={wrapRef} className={[s.stage, className].filter(Boolean).join(" ")}>
      {available ? (
        <canvas ref={canvasRef} className={s.canvas} aria-label={canvasLabel} />
      ) : (
        <RenderSlot label={label} sub={sub} grounded wobble />
      )}
    </div>
  );
}
