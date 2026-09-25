import css from "./BombPanel.module.css";
import { InspectorSection } from "../InspectorSection/InspectorSection";
import { Kicker } from "../Kicker/Kicker";
import { Stepper } from "../Stepper/Stepper";
import { UndoIcon } from "../icons/Icons";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";

/**
 * A bomb's clock (CONTEXT.md: Bomb, ADR 0126) — shown only on a Segment whose
 * Asset is one, because a bomb is a shape, never a switch. How long it burns
 * once someone picks it up, and how long it is gone after it goes off. The
 * fast warning and the blast's reach are the game's, the same for every bomb.
 */
export function BombPanel({ engine }: { engine: BuilderEngine }) {
  useEngineVersion(engine);
  const primary = engine.primary;
  const segment = primary !== undefined ? engine.track[primary] : undefined;
  const def = segment ? engine.library[segment.moduleId]?.bomb : undefined;
  if (!segment || !def) return null;

  const fuse = segment.bomb?.fuseSeconds ?? def.fuseSeconds;
  const back = segment.bomb?.returnSeconds ?? def.returnSeconds;
  const authored = segment.bomb !== undefined;

  return (
    <InspectorSection id="bomb" title="BOMB" defaultOpen summary={`${fuse} s fuse · back in ${back} s`}>
      <div className={css.root}>
        <div className={css.row}>
          <Kicker>FUSE · from the pick-up</Kicker>
          {authored && (
            <button type="button" className={css.reset} title={`back to this Asset's own ${def.fuseSeconds} s and ${def.returnSeconds} s`}
              aria-label="reset bomb timing" onClick={() => engine.setSegmentBomb(undefined)}>
              <UndoIcon size={12} />
            </button>
          )}
        </div>
        <Stepper value={fuse.toFixed(1)} onStep={(delta, fine) => engine.stepBomb("fuseSeconds", delta, fine)}
          onCommit={(committed) => engine.setSegmentBomb({ ...segment.bomb, fuseSeconds: committed })} />

        <Kicker>BACK AFTER · from the blast</Kicker>
        <Stepper value={back.toFixed(1)} onStep={(delta, fine) => engine.stepBomb("returnSeconds", delta, fine)}
          onCommit={(committed) => engine.setSegmentBomb({ ...segment.bomb, returnSeconds: committed })} />

        <p className={css.hint}>
          Picking it up lights it; it keeps burning in anyone's hands and goes off wherever it is,
          then lies here again {back} s later{authored ? "" : " · this Asset's own default"}.
        </p>
      </div>
    </InspectorSection>
  );
}
