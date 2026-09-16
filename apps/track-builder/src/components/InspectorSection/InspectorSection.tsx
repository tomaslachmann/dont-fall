import { useState, type ReactNode } from "react";
import css from "./InspectorSection.module.css";
import { loadSectionState, storeSectionOpen } from "./sectionStore.js";

/**
 * One foldable block of the inspector — the only way a property gets into it.
 *
 * Every property the builder grows (a belt, ice, a Checkpoint, whatever comes
 * next) used to cost the card a permanently-open panel with its own ATTACH
 * button, and four of those already pushed the Motion editor out of a card
 * that does not scroll. A section instead costs one 28px header: collapsed, it
 * still says what it holds through `summary`, so folding hides the controls,
 * never the state.
 *
 * The panel owns its section (it renders one, with its own summary) rather than
 * the inspector wrapping it — a new property is then a new self-contained file.
 */
export function InspectorSection({
  id,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  /** Stable across releases — it keys the remembered open/closed choice. */
  id: string;
  title: string;
  /** What this section holds, read at a glance while it's folded. `—` when empty. */
  summary?: string | undefined;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => loadSectionState()[id] ?? defaultOpen);

  const toggle = (): void => {
    setOpen((was) => {
      storeSectionOpen(id, !was);
      return !was;
    });
  };

  return (
    <section className={css.section}>
      <button type="button" className={css.head} aria-expanded={open} onClick={toggle}>
        <span className={css.caret} aria-hidden>{open ? "⌄" : "›"}</span>
        <span className={css.title}>{title}</span>
        <span className={[css.summary, summary ? "" : css.empty].join(" ")}>{summary ?? "—"}</span>
      </button>
      {/* Kept mounted while folded: the Motion editor is an imperative island the
          engine attaches to, and re-attaching it on every fold would drop its state. */}
      <div className={css.body} hidden={!open}>{children}</div>
    </section>
  );
}
