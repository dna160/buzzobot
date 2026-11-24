import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../client.js';
import { clients, reportLinks } from '../schema.js';
import type { ClientSummary } from './dashboard.js';

/**
 * Shareable Template Report links (`/r/:token`) — what the portal's "Generate
 * Report" opens, and what a brand's own people are sent.
 *
 * One live link per client. Asking again returns the same token, so a link
 * that was pasted into a chat last month keeps working; revoking it is the only
 * way to retire it, after which the next request issues a new one.
 */

export interface ReportLinkRow {
  id: string;
  clientId: string;
  token: string;
  createdBy: string | null;
  createdAt: Date;
  revokedAt: Date | null;
}

/** 32 random bytes, URL-safe — ~256 bits, so a token cannot be guessed or enumerated. */
export function newReportLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function getActiveReportLink(db: Database, clientId: string): Promise<ReportLinkRow | null> {
  const [row] = await db
    .select()
    .from(reportLinks)
    .where(and(eq(reportLinks.clientId, clientId), isNull(reportLinks.revokedAt)))
    .limit(1);
  return (row as ReportLinkRow | undefined) ?? null;
}

/**
 * The client's live link, issuing one if there is none.
 *
 * Two callers racing here both miss the read and both insert; the partial
 * unique index (`report_links_client_active_uq`) lets exactly one win, and the
 * loser returns the winner's token rather than failing.
 */
export async function issueReportLink(
  db: Database,
  clientId: string,
  createdBy: string | null,
): Promise<{ link: ReportLinkRow; created: boolean }> {
  const existing = await getActiveReportLink(db, clientId);
  if (existing) return { link: existing, created: false };

  const [row] = await db
    .insert(reportLinks)
    .values({ clientId, token: newReportLinkToken(), createdBy })
    .onConflictDoNothing()
    .returning();
  if (row) return { link: row as ReportLinkRow, created: true };

  const winner = await getActiveReportLink(db, clientId);
  if (!winner) throw new Error(`Could not issue a report link for client ${clientId}`);
  return { link: winner, created: false };
}

/** Revoke the client's live link. Returns how many were revoked (0 or 1). */
export async function revokeReportLink(db: Database, clientId: string): Promise<number> {
  const rows = await db
    .update(reportLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(reportLinks.clientId, clientId), isNull(reportLinks.revokedAt)))
    .returning({ id: reportLinks.id });
  return rows.length;
}

/** The client a live token opens, or null for an unknown or revoked one. */
export async function resolveReportLink(db: Database, token: string): Promise<ClientSummary | null> {
  const [row] = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      brandColor: clients.brandColor,
      currency: clients.currency,
      timezone: clients.timezone,
      northStar: clients.northStar,
      tier: clients.tier,
    })
    .from(reportLinks)
    .innerJoin(clients, eq(clients.id, reportLinks.clientId))
    .where(and(eq(reportLinks.token, token), isNull(reportLinks.revokedAt)))
    .limit(1);
  return (row as ClientSummary | undefined) ?? null;
}
