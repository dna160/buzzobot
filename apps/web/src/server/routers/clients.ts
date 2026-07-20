import { listClients } from '@tempo/db';
import { router, publicProcedure } from '../trpc.js';

export const clientsRouter = router({
  /** All clients the current agency manages (unscoped until auth lands). */
  list: publicProcedure.query(async ({ ctx }) => {
    return listClients(ctx.db);
  }),
});
