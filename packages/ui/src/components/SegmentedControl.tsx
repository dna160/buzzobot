import { cn } from '../utils/cn.js';

export interface SegmentOption<T extends string> {
  label: string;
  value: T;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

/**
 * A compact segmented toggle (Paid / Both / Organic on the dashboard). Purely
 * presentational + controlled — state lives with the consumer.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className,
  ...aria
}: SegmentedControlProps<T>) {
  const h = size === 'sm' ? 'h-8' : 'h-9';
  return (
    <div
      role="tablist"
      aria-label={aria['aria-label']}
      className={cn('inline-flex items-center gap-0.5 rounded-md border border-border bg-bg-subtle p-0.5', h, className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex h-full items-center rounded-[5px] px-3 text-[13px] font-medium transition-colors duration-[var(--dur-fast)] ease-standard',
              active
                ? 'bg-surface text-primary shadow-xs'
                : 'text-secondary hover:text-primary',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
