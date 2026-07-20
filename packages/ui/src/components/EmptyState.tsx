import type { ReactNode } from 'react';
import { cn } from '../utils/cn.js';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** A centered, friendly empty/zero-data state. */
export const EmptyState = ({ title, description, icon, action, className }: EmptyStateProps) => (
  <div
    className={cn(
      'flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface/50 px-6 py-12 text-center',
      className,
    )}
  >
    {icon ? <div className="mb-3 text-muted">{icon}</div> : null}
    <h3 className="text-sm font-semibold text-primary">{title}</h3>
    {description ? <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p> : null}
    {action ? <div className="mt-4">{action}</div> : null}
  </div>
);
