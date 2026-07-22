import type { Metadata } from 'next';
import { HourlyView } from '@/components/hourly/HourlyView';

export const metadata: Metadata = {
  title: 'Hourly Performance · Tempo Insight Engine',
};

/** Client intraday route. Params are async in Next 15. */
export default async function ClientHourlyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <HourlyView slug={slug} />;
}
