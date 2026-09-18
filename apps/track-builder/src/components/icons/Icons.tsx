import type { SVGProps } from 'react';

/* Line icons, 2.2-2.6 stroke, currentColor. No decorative illustration lives here. */

type P = SVGProps<SVGSVGElement> & { size?: number };

const Svg = ({ size = 14, children, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={2.3} strokeLinecap="round" aria-hidden {...rest}>{children}</svg>
);

export const SearchIcon = (p: P) => (
  <Svg {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" /></Svg>
);

export const UndoIcon = (p: P) => (
  <Svg {...p} style={{ transform: 'scaleX(-1)', ...p.style }}><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 3v5h-5" /></Svg>
);

export const RedoIcon = (p: P) => (
  <Svg {...p}><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 3v5h-5" /></Svg>
);

export const TrashIcon = (p: P) => (
  <Svg {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></Svg>
);

export const DuplicateIcon = (p: P) => (
  <Svg {...p}><rect x="4" y="4" width="10" height="10" rx="2" /><rect x="10" y="10" width="10" height="10" rx="2" /></Svg>
);

export const PlayIcon = ({ size = 11, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden {...rest}><path d="M2 1v10l9-5z" /></svg>
);

export const PauseIcon = ({ size = 11, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden {...rest}>
    <rect x="2" y="1" width="3" height="10" rx="1" /><rect x="7" y="1" width="3" height="10" rx="1" />
  </svg>
);
