import base from './index.js';

/**
 * ESLint config for the Next.js web app. Extends the shared base with
 * browser globals. (Next's own plugin is wired via next.config for build.)
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  ...base,
  {
    languageOptions: {
      globals: {
        React: 'readonly',
        JSX: 'readonly',
      },
    },
  },
];
