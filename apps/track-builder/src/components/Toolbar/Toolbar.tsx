import { useState } from "react";
import {
  DEFAULT_SURVIVOR_TARGET,
  DEFAULT_TIME_LIMIT_MS,
  MAX_SURVIVOR_TARGET,
  MAX_TIME_LIMIT_MS,
  MIN_SURVIVOR_TARGET,
  MIN_TIME_LIMIT_MS,
} from "@dont-fall/shared";
import css from "./Toolbar.module.css";
import { Field } from "../Field/Field";
import { Kicker } from "../Kicker/Kicker";
import { UndoIcon, RedoIcon, TrashIcon } from "../icons/Icons";
import type { BuilderEngine } from "../../engine.js";
import { useEngineVersion } from "../../hooks/useEngine.js";
import { parseDraftSurvivorTarget } from "../../survivorTargetField.js";
import { parseDraftTimeLimitMs } from "../../timeLimitField.js";

interface Props {
  engine: BuilderEngine;
  onBrowse: () => void;
}

function Status({ engine }: { engine: BuilderEngine }) {
  const { text, kind } = engine.status;
  if (kind === "error") {
    return <span className={[css.status, css.statusError].join(" ")}><span className={css.bang}>!</span>{text}</span>;
  }
  if (kind === "ok") {
    return <span className={[css.status, css.statusOk].join(" ")}>✓ {text}</span>;
  }
  return <span className={[css.status, css.statusQuiet].join(" ")}>{text}</span>;
}

/** Region E. Reads left → right as history / metadata / persistence / status. Destructive actions live together, one hop from the undo that reverses them. */
export function Toolbar({ engine, onBrowse }: Props) {
  useEngineVersion(engine);
  // Draft text fields — local, reset by the parent's key on every load/save,
  // so typing never re-renders the shell and a load always shows the
  // Revision's own values.
  const meta = engine.loadedTrack;
  const [name, setName] = useState(meta?.name ?? "");
  const [limit, setLimit] = useState(String(Math.round((meta?.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS) / 1000)));
  const [survivors, setSurvivors] = useState(String(meta?.survivorTarget ?? DEFAULT_SURVIVOR_TARGET));
  const [trackId, setTrackId] = useState(meta?.id ?? "");
  const [apiOpen, setApiOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState(engine.apiUrl);

  const defaults = () => ({
    timeLimitMs: parseDraftTimeLimitMs(limit),
    survivorTarget: parseDraftSurvivorTarget(survivors),
  });
  const segments = engine.track.length;

  return (
    <div className={css.root}>
      <div className={css.cluster}>
        <button type="button" className={css.btn} disabled={!engine.canUndo}
          onClick={() => engine.undo()}><UndoIcon />UNDO</button>
        <button type="button" className={css.btn} disabled={!engine.canRedo}
          title={engine.canRedo ? undefined : "nothing to redo"}
          onClick={() => engine.redo()}><RedoIcon />REDO</button>
        <span className={css.divider} />
        <button type="button" className={[css.btn, css.danger].join(' ')}
          onClick={() => engine.deleteSelected()}><TrashIcon />DELETE</button>
        <button type="button" className={css.btn}
          onClick={() => engine.removeLast()}>REMOVE LAST</button>
      </div>

      <span className={css.rule} />

      <div className={css.group}>
        <Kicker>TRACK</Kicker>
        <Field value={name} variant="text" width={150} placeholder="my track" onChange={setName} />
        <Kicker>LIMIT</Kicker>
        <Field value={limit} width={48} type="number" min={MIN_TIME_LIMIT_MS / 1000} max={MAX_TIME_LIMIT_MS / 1000}
          step={5} title={`time limit in seconds (${MIN_TIME_LIMIT_MS / 1000}–${MAX_TIME_LIMIT_MS / 1000})`}
          onChange={setLimit} />
        <Kicker>SURVIVORS</Kicker>
        <Field value={survivors} width={40} type="number" min={MIN_SURVIVOR_TARGET} max={MAX_SURVIVOR_TARGET}
          step={1} title={`survivor target (${MIN_SURVIVOR_TARGET}–${MAX_SURVIVOR_TARGET})`}
          onChange={setSurvivors} />
      </div>

      <span className={css.rule} />

      <div className={css.group}>
        <button type="button" className={css.save}
          onClick={() => void engine.saveTrack(name, defaults())}>SAVE</button>
        <Field value={trackId} variant="text" width={74} placeholder="m1-playground" onChange={setTrackId} />
        <button type="button" className={css.btn}
          onClick={() => void engine.loadTrackById(trackId.trim() || "m1-playground")}>LOAD</button>
        <button type="button" className={[css.btn, css.inkBtn].join(" ")} onClick={onBrowse}>BROWSE</button>
      </div>

      <div className={css.tail}>
        {apiOpen ? (
          <Field value={apiUrl} variant="text" width={180} title="API base URL — Enter commits"
            onChange={(v) => {
              setApiUrl(v);
              engine.setApiUrl(v);
            }} />
        ) : (
          <button type="button" className={css.apiUrl} title="set once a day, not every minute"
            onClick={() => setApiOpen(true)}>API {engine.apiUrl}</button>
        )}
        <span className={css.segments}>{segments} SEGMENT{segments === 1 ? "" : "S"}</span>
        <Status engine={engine} />
        <button type="button" className={css.playtest}
          onClick={() => void engine.playtest(defaults())}>PLAYTEST</button>
      </div>
    </div>
  );
}
