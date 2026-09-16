/**
 * Which inspector sections the author left open, across reloads.
 *
 * Only *explicit* toggles are stored: a section the author has never touched
 * falls back to its own `defaultOpen`, so adding a section (or changing what a
 * sensible default is) never fights a stale entry left in a browser.
 */
const KEY = "tb-inspector-sections";

export type SectionOpenState = Record<string, boolean>;

export const loadSectionState = (): SectionOpenState => {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, open]) => typeof open === "boolean"),
    ) as SectionOpenState;
  } catch {
    return {};
  }
};

export const storeSectionOpen = (id: string, open: boolean): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadSectionState(), [id]: open }));
  } catch {
    // Private mode / quota — the choice just doesn't survive the session.
  }
};
