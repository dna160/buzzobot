import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Next only reads `.env*` next to the app, but this is a monorepo where the
 * data-source configuration (which provider to use, where the export lives)
 * is workspace-wide and shared with the db package's CLI scripts. Load the
 * workspace-root `.env` here so the web server and the scripts agree.
 *
 * Values already in the environment win, so `apps/web/.env.local` and real
 * shell exports still override.
 */
function loadWorkspaceEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) break;
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
  const file = resolve(dir, '.env');
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadWorkspaceEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are shipped as TS source; transpile them here.
  transpilePackages: ['@tempo/ui', '@tempo/core', '@tempo/db', '@tempo/tiktok'],
  // Native/server-only deps must not be bundled for the client or server graph.
  serverExternalPackages: ['@electric-sql/pglite', 'postgres', 'playwright-core'],
  webpack: (config, { isServer }) => {
    // Workspace packages use ESM `.js` import specifiers that point at `.ts`
    // source. Teach webpack to resolve them (matches tsc's bundler resolution).
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    // Keep native/server-only DB drivers out of the bundle. serverExternalPackages
    // doesn't cover imports reached *through* a transpiled workspace package
    // (@tempo/db), so externalize them explicitly for the server build. This lets
    // PGlite resolve its own WASM assets from node_modules at runtime.
    if (isServer) {
      config.externals.push('@electric-sql/pglite', 'postgres');
    }
    return config;
  },
};

export default nextConfig;
