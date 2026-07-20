import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../utils/cn.js';

/** A dense, hairline-ruled data table kit. Compose the parts directly. */

export const Table = ({ className, ...props }: HTMLAttributes<HTMLTableElement>) => (
  <div className="w-full overflow-x-auto">
    <table className={cn('w-full border-collapse text-[13px]', className)} {...props} />
  </div>
);

export const THead = ({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) => (
  <thead
    className={cn('border-b border-border text-left text-[12px] text-muted', className)}
    {...props}
  />
);

export const TBody = ({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody className={cn('divide-y divide-border-subtle', className)} {...props} />
);

export const TR = ({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) => (
  <tr
    className={cn('transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover', className)}
    {...props}
  />
);

export interface THProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}
export const TH = ({ numeric, className, ...props }: THProps) => (
  <th
    className={cn(
      'whitespace-nowrap px-3 py-2 font-medium',
      numeric ? 'text-right tabular-nums' : 'text-left',
      className,
    )}
    {...props}
  />
);

export interface TDProps extends TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}
export const TD = ({ numeric, className, ...props }: TDProps) => (
  <td
    className={cn(
      'whitespace-nowrap px-3 py-2.5 text-secondary',
      numeric ? 'text-right font-mono tabular-nums text-primary' : 'text-left',
      className,
    )}
    {...props}
  />
);
