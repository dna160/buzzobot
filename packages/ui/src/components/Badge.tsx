import type { HTMLAttributes } from 'react';
import { cn } from '../utils/cn.js';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Render a small leading status dot. */
  dot?: boolean;
}

const tones: Record<Tone, { text: string; bg: string; dot: string }> = {
  neutral: { text: 'text-secondary', bg: 'bg-surface-active', dot: 'bg-muted' },
  accent: { text: 'text-accent', bg: 'bg-accent-subtle', dot: 'bg-accent' },
  success: { text: 'text-success', bg: 'bg-success-subtle', dot: 'bg-success' },
  warning: { text: 'text-warning', bg: 'bg-warning-subtle', dot: 'bg-warning' },
  danger: { text: 'text-danger', bg: 'bg-danger-subtle', dot: 'bg-danger' },
  info: { text: 'text-info', bg: 'bg-info-subtle', dot: 'bg-info' },
};

export const Badge = ({ tone = 'neutral', dot = false, className, children, ...props }: BadgeProps) => {
  const t = tones[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium',
        t.text,
        t.bg,
        className,
      )}
      {...props}
    >
      {dot ? <span className={cn('h-1.5 w-1.5 rounded-full', t.dot)} /> : null}
      {children}
    </span>
  );
};
