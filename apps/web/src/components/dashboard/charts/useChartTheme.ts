'use client';

import { useEffect, useState } from 'react';

/**
 * Recharts writes color props as SVG *presentation attributes*, where CSS
 * `var(--token)` does not resolve. Worse, several of our tokens are semantic
 * aliases (`--viz-series-paid: var(--viz-cat-1)`), and
 * `getComputedStyle().getPropertyValue()` returns the *literal* `var(...)`
 * without resolving it. So we resolve each token to a concrete `rgb(...)` by
 * letting the browser compute it on a throwaway element — and re-resolve on
 * theme change so charts stay theme-aware.
 */
const TOKENS = {
  paid: '--viz-series-paid',
  organic: '--viz-series-organic',
  roas: '--viz-cat-4',
  engagement: '--viz-cat-7',
  grid: '--viz-grid',
  axis: '--viz-axis',
  tick: '--viz-tick',
  cursor: '--color-border-strong',
} as const;

// Sensible dark-theme fallbacks for the first paint / SSR.
const FALLBACK: ChartColors = {
  paid: '#3987E5',
  organic: '#199E70',
  roas: '#C98500',
  engagement: '#9085E9',
  grid: '#23262C',
  axis: '#363B43',
  tick: '#6B7280',
  cursor: '#363B43',
};

export type ChartColors = Record<keyof typeof TOKENS, string>;

const readColors = (): ChartColors => {
  if (typeof window === 'undefined') return FALLBACK;
  // One hidden probe resolves any (possibly nested) var() to a real color.
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const out = {} as ChartColors;
  try {
    for (const [key, token] of Object.entries(TOKENS) as [keyof typeof TOKENS, string][]) {
      probe.style.color = '';
      probe.style.color = `var(${token})`;
      const resolved = getComputedStyle(probe).color;
      out[key] = resolved && resolved !== 'rgba(0, 0, 0, 0)' ? resolved : FALLBACK[key];
    }
  } finally {
    probe.remove();
  }
  return out;
};

export function useChartTheme(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(readColors);

  useEffect(() => {
    setColors(readColors());
    const observer = new MutationObserver(() => setColors(readColors()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return colors;
}
