import { redirect } from 'next/navigation';
import { getDb, listClients } from '@tempo/db';

// Reads the database at request time — never statically prerendered.
export const dynamic = 'force-dynamic';

/** Land on the first client's dashboard. */
export default async function HomePage() {
  const { db } = getDb();
  const clients = await listClients(db);
  const first = clients[0];
  redirect(first ? `/clients/${first.slug}` : '/clients/aurora-skincare');
}
