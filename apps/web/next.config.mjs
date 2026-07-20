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
