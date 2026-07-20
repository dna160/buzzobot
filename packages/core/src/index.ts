/**
 * @tempo/core — the shared domain kernel.
 *
 * Everything downstream (ingestion, database, API, web) depends on these
 * types, the metric catalog, and the derivation logic. No framework code,
 * no I/O — pure domain.
 */

export * from './domain/enums.js';
export * from './domain/entities.js';
export * from './metrics/catalog.js';
export * from './metrics/derive.js';
export * from './utils/format.js';
export * from './utils/date.js';
