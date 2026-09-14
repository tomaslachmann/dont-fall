/**
 * The accept/decline glyphs — bare SVGs, sized and stroked by the parent
 * (`accept`/`decline` button styles in each Screen's own CSS). Shared because
 * the Friends screen and the friend toasts draw the same two answers.
 */

export const TickIcon = () => (
  <svg viewBox="0 0 16 13" aria-hidden="true">
    <path d="M1.5 6.5l4.5 4.5L14.5 2" />
  </svg>
);

export const CrossIcon = () => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path d="M2 2l10 10M12 2L2 12" />
  </svg>
);
