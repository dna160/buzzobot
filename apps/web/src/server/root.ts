import { router } from './trpc.js';
import { clientsRouter } from './routers/clients.js';
import { dashboardRouter } from './routers/dashboard.js';
import { reportSpecRouter } from './routers/report-spec.js';
import { reportBenchmarkRouter } from './routers/report-benchmark.js';
import { settingsRouter } from './routers/settings.js';
import { strategySpecRouter } from './routers/strategy-spec.js';
import { strategyActionRouter } from './routers/strategy-action.js';

export const appRouter = router({
  clients: clientsRouter,
  dashboard: dashboardRouter,
  reportSpec: reportSpecRouter,
  reportBenchmark: reportBenchmarkRouter,
  settings: settingsRouter,
  strategySpec: strategySpecRouter,
  strategyAction: strategyActionRouter,
});

/** The API's type surface — imported by the client for end-to-end type safety. */
export type AppRouter = typeof appRouter;
