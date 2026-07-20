import { eq } from 'drizzle-orm';
import type { TikTokDataProvider } from '@tempo/tiktok';
import type { Database } from '../client.js';
import { agencies, clients, tiktokAccounts } from '../schema.js';

/**
 * Provision the demo tenant: an agency, one client, and the client's connected
 * TikTok accounts (paid + organic) as reported by the provider. Idempotent —
 * safe to run on every seed. In production this work is done by the onboarding
 * / OAuth flow instead (Phase 2).
 */
export interface DemoTenant {
  agencyId: string;
  clientId: string;
  clientSlug: string;
}

const DEMO_AGENCY = { name: 'Buzzo Media', slug: 'buzzo-media' };
const DEMO_CLIENT = {
  name: 'Aurora Skincare',
  slug: 'aurora-skincare',
  brandColor: '#1FD8C7',
  currency: 'USD',
  timezone: 'America/Los_Angeles',
};

export async function ensureDemoTenant(
  db: Database,
  provider: TikTokDataProvider,
): Promise<DemoTenant> {
  const [agency] = await db
    .insert(agencies)
    .values(DEMO_AGENCY)
    .onConflictDoUpdate({ target: agencies.slug, set: { name: DEMO_AGENCY.name } })
    .returning({ id: agencies.id });

  const agencyId = agency!.id;

  const [client] = await db
    .insert(clients)
    .values({ agencyId, ...DEMO_CLIENT })
    .onConflictDoUpdate({
      target: [clients.agencyId, clients.slug],
      set: { name: DEMO_CLIENT.name, brandColor: DEMO_CLIENT.brandColor },
    })
    .returning({ id: clients.id });

  const clientId = client!.id;

  // Connect the provider's accounts to this client. Fixtures return two; the
  // live provider returns whatever the OAuth connection discovered.
  const providerAccounts = await provider.listAccounts();
  for (const acct of providerAccounts) {
    await db
      .insert(tiktokAccounts)
      .values({
        clientId,
        surface: acct.surface,
        externalId: acct.externalId,
        displayName: acct.displayName,
        username: acct.username,
        avatarUrl: acct.avatarUrl,
        status: acct.status,
      })
      .onConflictDoUpdate({
        target: [tiktokAccounts.surface, tiktokAccounts.externalId],
        set: { clientId, displayName: acct.displayName, status: acct.status },
      });
  }

  return { agencyId, clientId, clientSlug: DEMO_CLIENT.slug };
}

/** Fetch the (surface, externalId) pairs currently connected for a client. */
export async function listConnectedAccounts(db: Database, clientId: string) {
  return db
    .select({
      surface: tiktokAccounts.surface,
      externalId: tiktokAccounts.externalId,
      displayName: tiktokAccounts.displayName,
      username: tiktokAccounts.username,
      avatarUrl: tiktokAccounts.avatarUrl,
      status: tiktokAccounts.status,
    })
    .from(tiktokAccounts)
    .where(eq(tiktokAccounts.clientId, clientId));
}
