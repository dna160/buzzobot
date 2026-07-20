import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import type { Context } from './context.js';

/**
 * tRPC initialization. superjson lets Dates and other rich types cross the
 * wire without manual serialization.
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
