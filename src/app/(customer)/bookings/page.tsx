import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge, toneForStatus } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/States';
import { getCurrentUser } from '@/lib/auth';
import { listCustomerBookings, type BookingListItem } from '@/lib/customer-bookings';
import { formatDate, formatINR } from '@/lib/format';

export const metadata: Metadata = { title: 'My bookings' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * CUSTOMER BOOKING LIST
 *
 * Server-rendered from the authenticated customer's OWN records. The data query
 * is scoped by customerId - the route guard alone is not what keeps other
 * users' bookings private.
 */
export default async function BookingsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  // Anonymous visitors are sent to sign in, preserving the requested page as a
  // safe internal `next` (percent-encoded, matching the account page) so a
  // successful login returns them here. No bookings are queried or rendered
  // without an authenticated session.
  if (!user) redirect('/login?next=%2Fbookings');

  const params = await searchParams;
  const status = firstValue(params.status);
  const rawPage = Number(firstValue(params.page) ?? '1');
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const { items, total } = await listCustomerBookings(user.id, { status, page });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">My bookings</h1>
          <p className="mt-1 text-sm text-ink-500">
            {total === 0
              ? 'You have not placed any bookings yet.'
              : `${total} ${total === 1 ? 'booking' : 'bookings'} in total.`}
          </p>
        </div>
        <Link
          href="/categories"
          className="inline-flex items-center gap-2 self-start rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated"
        >
          <Icon name="bolt" size={16} />
          Book a service
        </Link>
      </header>

      <div className="mt-6 flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Filter by status">
        <FilterChip href="/bookings" label="All" active={!status} />
        <FilterChip href="/bookings?status=REQUESTED" label="Requested" active={status === 'REQUESTED'} />
        <FilterChip
          href="/bookings?status=SERVICE_IN_PROGRESS"
          label="In progress"
          active={status === 'SERVICE_IN_PROGRESS'}
        />
        <FilterChip href="/bookings?status=PAID" label="Paid" active={status === 'PAID'} />
        <FilterChip href="/bookings?status=CLOSED" label="Closed" active={status === 'CLOSED'} />
      </div>

      <div className="mt-4">
        {items.length === 0 ? (
          <div className="rounded-card border border-ink-200 bg-white">
            <EmptyState
              icon="clipboard"
              title={status ? 'No bookings with this status' : 'No bookings yet'}
              description={
                status
                  ? 'Try a different status filter.'
                  : 'Browse the service categories to place your first booking.'
              }
              action={
                <Link
                  href={status ? '/bookings' : '/categories'}
                  className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated"
                >
                  {status ? 'Clear filter' : 'Browse categories'}
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((booking) => (
              <BookingRow key={booking.id} booking={booking} />
            ))}
          </ul>
        )}
      </div>

      {/* Simple previous/next paging; server-rendered so there is no client JS. */}
      {total > 10 && (
        <nav className="mt-6 flex items-center justify-between" aria-label="Pagination">
          {page > 1 ? (
            <Link
              href={`/bookings?page=${page - 1}${status ? `&status=${status}` : ''}`}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 hover:bg-ink-50"
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-ink-500">Page {page}</span>
          {page * 10 < total ? (
            <Link
              href={`/bookings?page=${page + 1}${status ? `&status=${status}` : ''}`}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 hover:bg-ink-50"
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}

function BookingRow({ booking }: { booking: BookingListItem }) {
  return (
    <li>
      <Link
        href={`/bookings/${booking.id}`}
        className="group block rounded-xl border border-ink-200 bg-white p-4 shadow-card transition-all duration-300 hover:border-brand-300 hover:shadow-elevated hover:-translate-y-0.5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-ink-500">
                {booking.reference}
              </span>
              <StatusBadge label={booking.statusLabel} tone={toneForStatus(booking.status)} dot />
            </div>
            <h2 className="mt-1.5 text-sm font-semibold text-ink-900 group-hover:text-brand-700">
              {booking.service.name}
            </h2>
            <p className="mt-1 text-xs text-ink-500">{booking.statusHint}</p>
          </div>

          <div className="text-right">
            <p className="text-xs font-medium text-ink-400">Amount</p>
            <p className="text-sm font-bold tabular-nums text-ink-900">
              {booking.quotedPaise != null
                ? formatINR(booking.quotedPaise)
                : booking.budgetMinPaise != null
                  ? `${formatINR(booking.budgetMinPaise)} – ${formatINR(booking.budgetMaxPaise)}`
                  : 'On request'}
            </p>
          </div>
        </div>

        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-ink-100 pt-3 text-xs text-ink-500">
          <div className="flex gap-1.5">
            <dt className="text-ink-400">Booked</dt>
            <dd className="font-medium text-ink-700">{formatDate(booking.createdAt)}</dd>
          </div>
          {booking.scheduledFor && (
            <div className="flex gap-1.5">
              <dt className="text-ink-400">Scheduled</dt>
              <dd className="font-medium text-ink-700">{formatDate(booking.scheduledFor)}</dd>
            </div>
          )}
          {booking.technicianName && (
            <div className="flex gap-1.5">
              <dt className="text-ink-400">Technician</dt>
              <dd className="font-medium text-ink-700">{booking.technicianName}</dd>
            </div>
          )}
          {booking.providerName && (
            <div className="flex gap-1.5">
              <dt className="text-ink-400">Provider</dt>
              <dd className="font-medium text-ink-700">{booking.providerName}</dd>
            </div>
          )}
        </dl>
      </Link>
    </li>
  );
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? 'bg-ink-900 text-white'
          : 'bg-white text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50'
      }`}
    >
      {label}
    </Link>
  );
}

function firstValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}