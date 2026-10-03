import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getServiceBySlug, getServiceReviews } from '@/lib/queries';
import { ServiceDetailView } from '@/components/customer/ServiceDetail';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const service = await getServiceBySlug(slug);
  if (!service) return { title: 'Service not found' };
  return {
    title: service.name,
    description: service.description ?? `${service.name} on MOYO`,
  };
}

/**
 * SERVICE DETAIL
 *
 * A thin server component: it resolves the data and hands it to the presentational
 * view. Only provider-published values are passed down, so the UI cannot invent
 * a price, rating or availability.
 */
export default async function ServicePage({ params }: Params) {
  const { slug } = await params;
  const service = await getServiceBySlug(slug);
  if (!service) notFound();

  const reviews = await getServiceReviews(service.id);
  return <ServiceDetailView service={service} reviews={reviews} />;
}