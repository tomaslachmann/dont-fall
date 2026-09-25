import css from "./BrowsePanel.module.css";
import { StatusPlate } from "../StatusPlate/StatusPlate";
import { Kicker } from "../Kicker/Kicker";
import type { TrackDraftListing, TrackListing } from "@dont-fall/shared";
import type { BrowsePanelState } from "../../engine.js";

interface Props {
  tracks: readonly TrackListing[];
  drafts: readonly TrackDraftListing[];
  activeId: string | null;
  activeDraftId: string | null;
  state: BrowsePanelState;
  onClose: () => void;
  onSelect: (id: string) => void;
  onSelectDraft: (id: string) => void;
}

export function BrowsePanel({
  tracks,
  drafts,
  activeId,
  activeDraftId,
  state,
  onClose,
  onSelect,
  onSelectDraft,
}: Props) {
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
        <div className={css.sections}>
          {/* Drafts first: unfinished work is what a session resumes, and a
              Draft the MCP server left (ADR 0114/0115) is only findable here. */}
          {drafts.length > 0 && (
            <section className={css.section}>
              <Kicker>DRAFTS</Kicker>
              <ul className={css.list}>
                {drafts.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => onSelectDraft(d.id)}
                      title={`${d.roundType} · ${d.segmentCount} Segment(s)`}
                      className={[css.row, d.id === activeDraftId ? css.active : ""].join(" ")}>
                      <span className={css.name}>{d.name ?? "(untitled)"}</span>
                      <span className={css.rev}>{d.segmentCount}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={css.section}>
            {drafts.length > 0 && <Kicker>TRACKS</Kicker>}
            {tracks.length === 0 ? (
              <StatusPlate kind="empty">NO TRACKS SAVED YET</StatusPlate>
            ) : (
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
          </section>
        </div>
      )}
    </div>
  );
}
