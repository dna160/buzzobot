/**
 * Tailwind preset that maps the Tempo design tokens (CSS custom properties in
 * `styles/tokens.css`) onto Tailwind's theme. Consuming apps spread this preset
 * and get semantic classes like `bg-surface`, `text-secondary`, `border-subtle`,
 * `text-accent`, `rounded-lg` that automatically respond to the active theme.
 *
 * @type {import('tailwindcss').Config}
 */
const preset = {
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Surfaces
        canvas: 'var(--color-bg-base)',
        'bg-subtle': 'var(--color-bg-subtle)',
        surface: 'var(--color-surface)',
        'surface-hover': 'var(--color-surface-hover)',
        'surface-active': 'var(--color-surface-active)',
        elevated: 'var(--color-elevated)',
        // Borders
        'border-subtle': 'var(--color-border-subtle)',
        border: 'var(--color-border)',
        'border-strong': 'var(--color-border-strong)',
        // Text
        primary: 'var(--color-text-primary)',
        secondary: 'var(--color-text-secondary)',
        muted: 'var(--color-text-muted)',
        disabled: 'var(--color-text-disabled)',
        'on-accent': 'var(--color-text-on-accent)',
        'on-solid': 'var(--color-text-on-solid)',
        // Accents
        accent: 'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        'accent-active': 'var(--color-accent-active)',
        'accent-subtle': 'var(--color-accent-subtle)',
        accent2: 'var(--color-accent2)',
        'accent2-subtle': 'var(--color-accent2-subtle)',
        // Status
        success: 'var(--color-success)',
        'success-subtle': 'var(--color-success-subtle)',
        warning: 'var(--color-warning)',
        'warning-subtle': 'var(--color-warning-subtle)',
        danger: 'var(--color-danger)',
        'danger-subtle': 'var(--color-danger-subtle)',
        info: 'var(--color-info)',
        'info-subtle': 'var(--color-info-subtle)',
        // Delta cues
        'delta-positive': 'var(--color-delta-positive)',
        'delta-negative': 'var(--color-delta-negative)',
        'delta-neutral': 'var(--color-delta-neutral)',
        // Data-viz series
        'viz-paid': 'var(--viz-series-paid)',
        'viz-organic': 'var(--viz-series-organic)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        popover: 'var(--shadow-popover)',
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
        decelerate: 'var(--ease-decelerate)',
        emphasized: 'var(--ease-emphasized)',
      },
      fontSize: {
        kpi: ['var(--fs-kpi)', { lineHeight: 'var(--lh-kpi)', letterSpacing: 'var(--ls-kpi)' }],
        micro: ['var(--fs-micro)', { lineHeight: 'var(--lh-micro)', letterSpacing: 'var(--ls-micro)' }],
      },
    },
  },
  plugins: [],
};

export default preset;
