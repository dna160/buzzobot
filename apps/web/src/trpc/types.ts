import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/server/root';

/** End-to-end inferred input/output types for the tRPC API. */
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

/** The dashboard read-model as returned to the client. */
export type DashboardResult = RouterOutputs['dashboard']['get'];
