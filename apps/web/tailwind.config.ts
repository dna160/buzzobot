import type { Config } from 'tailwindcss';
import preset from '@tempo/ui/tailwind-preset';

const config: Config = {
  presets: [preset],
  content: [
    './src/**/*.{ts,tsx}',
    // Include the UI package source so its Tailwind classes are generated.
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      maxWidth: {
        content: 'var(--layout-content-max)',
      },
    },
  },
};

export default config;
