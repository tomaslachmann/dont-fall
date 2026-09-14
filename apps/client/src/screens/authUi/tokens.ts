/* Styling lives in CSS: tokens in src/styles/tokens.css, one .module.css per component.
   This file only carries the few things TypeScript needs to know about. */

/** Press personality. Selects the --df-dur-*, --df-ease, --df-lift, --df-squash group. */
export type Feel = 'snappy' | 'jelly';

export const FEELS: Feel[] = ['snappy', 'jelly'];

/** Design aspect of every stage. Screens are fluid — this is the shape, not a pixel size. */
export const STAGE_ASPECT = 16 / 9;
