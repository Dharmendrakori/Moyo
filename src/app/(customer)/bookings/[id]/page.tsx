import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { BookingStatusPanel, DetailRow } from '@/components/customer/BookingStatus';
import { getCurrentUser } from '@/lib/auth';
import { getCustomerBooking } from '@/lib/customer-bookings';
import { summarisePrice } from '@/lib/booking-tracking';
import {
  MODE_LABEL,
  SERVICE_TYPE_LABEL,
  CHARGING_LABEL,
  type BookingMode,
  type ServiceType,
} from '@/lib/domain';
import { formatDateTime, formatINR } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Booking status',
  robots: { index: false, follow: false },
};

/**
 * BOOKING TRACKING
 *
 * AUTHORIZATION: the customer's own id comes from the session and is passed to
 * `getCustomerBooking`, whose query is scoped by `customerId`. A booking
 * belonging to somebody else therefore matches nothing and renders the standard
 * not-found page. Changing the id in the URL cannot reveal another customer's
 * record - the ownership check is inside the query, not a filter applied after.
 */
export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=%2Fbookings');

  const { id } = await params;
  const booking = await getCustomerBooking(user.id, id);

  // Not yours and does not exist are deliberately indistinguishable.
  if (!booking) notFound();

  const price = summarisePrice({
    charging: booking.charging,
    quotedPaise: booking.quotedPaise,
    budgetMinPaise: booking.budgetMinPaise,
    budgetMaxPaise: booking.budgetMaxPaise,
  });

  const address = [
    booking.addressLine1,
    booking.addressLine2,
    booking.area,
    booking.city,
    booking.state,
    booking.pincode,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="mb-5">
        <ol className="flex items-center gap-1.5 text-xs text-ink-500">
          <li>
            <Link href="/" className="transition hover:text-brand-600">
              Home
            </Link>
          </li>
          <li aria-hidden>
            <Icon name="chevron-right" size={12} className="text-ink-300" />
          </li>
          <li>
            <Link href="/bookings" className="transition hover:text-brand-600">
              My bookings
            </Link>
          </li>
          <li aria-hidden>
            <Icon name="chevron-right" size={12} className="text-ink-300" />
          </li>
          <li className="font-mono font-medium text-ink-700" aria-current="page">
            {booking.reference}
          </li>
        </ol>
      </nav>

      <header>
        <p className="font-mono text-sm font-semibold text-ink-500">{booking.reference}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900">{booking.service.name}</h1>
        <p className="mt-1 text-sm text-ink-500">
          {booking.service.subCategory.category.name} &middot;{' '}
          {SERVICE_TYPE_LABEL[booking.serviceType as ServiceType] ?? booking.serviceType}
        </p>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <BookingStatusPanel
            status={booking.status}
            technician={
              booking.technician
                ? {
                    displayName: booking.technician.displayName,
                    headline: booking.technician.headline,
                    phone: booking.technician.phone,
                  }
                : null
            }
          />
        </div>

        <div className="space-y-4 lg:col-span-2">
          <section className="rounded-card border border-ink-200 bg-white p-5 shadow-card">
            <h2 className="text-sm font-semibold text-ink-900">Booking summary</h2>
            <dl className="mt-3 divide-y divide-ink-100">
              <DetailRow label="Charging">
                {CHARGING_LABEL[booking.charging as keyof typeof CHARGING_LABEL] ?? booking.charging}
              </DetailRow>
              <DetailRow label="Mode">
                {MODE_LABEL[booking.mode as BookingMode] ?? booking.mode}
              </DetailRow>
              <DetailRow label="Requested">
                {booking.scheduledFor
                  ? formatDateTime(booking.scheduledFor)
                  : (MODE_LABEL[booking.mode as BookingMode] ?? booking.mode)}
              </DetailRow>
              <DetailRow label="Booked on">{formatDateTime(booking.createdAt)}</DetailRow>
            </dl>
          </section>

          <section className="rounded-card border border-ink-200 bg-white p-5 shadow-card">
            <h2 className="text-sm font-semibold text-ink-900">Service location</h2>
            <p className="mt-2 flex items-start gap-2 text-sm text-ink-700">
              <Icon name="location" size={16} className="mt-0.5 shrink-0 text-ink-400" />
              {address}
            </p>
            <dl className="mt-3 divide-y divide-ink-100 border-t border-ink-100">
              <DetailRow label="Contact">{booking.contactName}</DetailRow>
              <DetailRow label="Phone">{booking.contactPhone}</DetailRow>
            </dl>
          </section>

          {/* Estimate and invoice are visually and verbally distinct. */}
          <section className="rounded-card border border-ink-200 bg-white p-5 shadow-card">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              {price.headline}
            </h2>
            <p className="mt-2 text-xl font-bold tabular-nums text-ink-900">
              {price.kind === 'published'
                ? formatINR(price.quotedPaise)
                : price.kind === 'budget'
                  ? `${formatINR(price.budgetMinPaise)} – ${formatINR(price.budgetMaxPaise)}`
                  : 'Not published'}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-600">{price.note}</p>
          </section>

          <section className="rounded-card border border-ink-200 bg-white p-5 shadow-card">
            <h2 className="text-sm font-semibold text-ink-900">Provider</h2>
            <p className="mt-1 text-sm font-medium text-ink-800">
              {booking.provider?.displayName ?? 'Not yet assigned'}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              Service provider across the 20 official service categories.
            </p>
          </section>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/bookings"
          className="rounded-lg px-4 py-2 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
        >
          Back to my bookings
        </Link>
      </div>
    </div>
  );
}
