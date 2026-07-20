import config from '@tempo/eslint-config/next';

export default [
  { ignores: ['.next/**', 'next-env.d.ts', 'next.config.mjs', 'postcss.config.mjs'] },
  ...config,
];
