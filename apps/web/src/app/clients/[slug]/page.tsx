import type { Metadata } from 'next';
import { DashboardView } from '@/components/dashboard/DashboardView';

export const metadata: Metadata = {
  title: 'Client Dashboard · Tempo Insight Engine',
};

/** Client dashboard route. Params are async in Next 15. */
export default async function ClientDashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <DashboardView slug={slug} />;
}
