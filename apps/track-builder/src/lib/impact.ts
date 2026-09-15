import type { ImpactKind } from '../types/builder';

/** The one definition of the danger language. Glyph + word travel with the color, always. */
export const IMPACT: Record<ImpactKind, { glyph: string; word: string; color: string; ink: string }> = {
  carry:      { glyph: '●', word: 'CARRIES / PUSHES', color: 'var(--df-color-go)',     ink: 'var(--df-color-go-ink)' },
  stagger:    { glyph: '▲', word: 'STAGGER',          color: 'var(--df-color-accent)', ink: 'var(--df-color-ink)' },
  knockdown:  { glyph: '✕', word: 'KNOCKDOWN',        color: 'var(--df-color-danger)', ink: '#ffffff' },
};

export const IMPACT_ORDER: ImpactKind[] = ['carry', 'stagger', 'knockdown'];
