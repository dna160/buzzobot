import { router } from './trpc.js';
import { clientsRouter } from './routers/clients.js';
import { dashboardRouter } from './routers/dashboard.js';
import { reportSpecRouter } from './routers/report-spec.js';
import { settingsRouter } from './routers/settings.js';

export const appRouter = router({
  clients: clientsRouter,
  dashboard: dashboardRouter,
  reportSpec: reportSpecRouter,
  settings: settingsRouter,
});

/** The API's type surface — imported by the client for end-to-end type safety. */
export type AppRouter = typeof appRouter;
