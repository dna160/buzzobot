import type { Metadata } from 'next';
import { ClientView } from '@/components/client/ClientView';

export const metadata: Metadata = {
  title: 'Client Performance · Tempo Insight Engine',
};

/** Client route. Params are async in Next 15. */
export default async function ClientHourlyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ClientView slug={slug} />;
}
