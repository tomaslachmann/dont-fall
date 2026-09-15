import css from "./BrowsePanel.module.css";
import { StatusPlate } from "../StatusPlate/StatusPlate";
import type { TrackListing } from "@dont-fall/shared";
import type { BrowsePanelState } from "../../engine.js";

interface Props {
  tracks: readonly TrackListing[];
  activeId: string | null;
  state: BrowsePanelState;
  onClose: () => void;
  onSelect: (id: string) => void;
}

export function BrowsePanel({ tracks, activeId, state, onClose, onSelect }: Props) {
  return (
    <div className={css.root}>
      <header className={css.head}>
        <h3 className={css.title}>Browse tracks</h3>
        <button type="button" className={css.close} aria-label="close" onClick={onClose}>✕</button>
      </header>

      {state === "loading" && <StatusPlate kind="loading">LOADING TRACKS…</StatusPlate>}
      {state === "empty" && <StatusPlate kind="empty">NO TRACKS SAVED YET</StatusPlate>}
      {state === "error" && <StatusPlate kind="error">API UNREACHABLE · CHECK URL</StatusPlate>}

      {state === "ready" && (
        <ul className={css.list}>
          {tracks.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => onSelect(t.id)}
                className={[css.row, t.id === activeId ? css.active : ""].join(" ")}>
                <span className={css.name}>{t.name ?? "(untitled)"}</span>
                <span className={css.rev}>#{t.id.slice(0, 4)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
