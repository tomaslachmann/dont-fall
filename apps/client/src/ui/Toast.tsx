import type { ReactNode } from 'react';
import Avatar from './Avatar';
import type { Skin } from './Avatar';
import s from './Toast.module.css';

export interface ToastProps {
  title: ReactNode;
  body: ReactNode;
  skin?: Skin | undefined;
  className?: string | undefined;
}

export default function Toast({ title, body, skin = 'cyan', className }: ToastProps) {
  return (
    <div className={[s.toast, className].filter(Boolean).join(' ')} role="status">
      <Avatar skin={skin} size={3.3} />
      <div className={s.body}>
        <span className={s.title}>{title}</span>
        <span className={s.sub}>{body}</span>
      </div>
    </div>
  );
}

export function Badge({ children, pulse }: { children?: ReactNode; pulse?: boolean }) {
  return <span className={[s.badge, pulse && s.pulse].filter(Boolean).join(' ')}>{children}</span>;
}
