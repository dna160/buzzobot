import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/root';
import { createContext } from '@/server/context';

/**
 * Single fetch-adapter endpoint that serves the whole tRPC API under
 * /api/trpc/*. Runs on the Node.js runtime because the DB layer (PGlite /
 * postgres) is not edge-compatible.
 */
export const runtime = 'nodejs';

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext,
  });

export { handler as GET, handler as POST };
