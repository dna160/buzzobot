import { getDb, type Database } from '@tempo/db';

/**
 * tRPC request context. Exposes the shared database handle. When auth lands
 * (Phase 2) the authenticated agency/user is attached here and every
 * procedure scopes its queries to it.
 */
export interface Context {
  db: Database;
}

export const createContext = async (): Promise<Context> => {
  const { db } = getDb();
  return { db };
};
