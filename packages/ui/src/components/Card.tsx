import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../utils/cn.js';

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border border-border bg-surface shadow-xs',
        'transition-colors duration-[var(--dur-base)] ease-standard',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export const CardHeader = ({ title, subtitle, action, className, children, ...props }: CardHeaderProps) => (
  <div className={cn('flex items-start justify-between gap-4 px-5 pt-4', className)} {...props}>
    <div className="min-w-0">
      {title ? (
        <h3 className="text-[15px] font-semibold leading-6 text-primary">{title}</h3>
      ) : null}
      {subtitle ? <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p> : null}
      {children}
    </div>
    {action ? <div className="shrink-0">{action}</div> : null}
  </div>
);

export const CardBody = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('px-5 py-4', className)} {...props} />
);
