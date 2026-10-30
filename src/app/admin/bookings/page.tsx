import Link from 'next/link';
import { requireAdminPage } from '@/lib/admin-page-guard';
import { listAllBookings } from '@/lib/customer-bookings';
import { adminBookingQuerySchema, normaliseSearchParams } from '@/lib/validation';
import { BOOKING_STATUSES, MODE_LABEL, type BookingMode } from '@/lib/domain';
import { STATUS_LABEL } from '@/lib/booking-state';
import { DataTable, Notice, PageHeader } from '@/components/admin/DataTable';
import { Pager, SearchField, SelectField, Toolbar } from '@/components/admin/Toolbar';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusBadge, toneForStatus } from '@/components/ui/StatusBadge';
import { Icon } from '@/components/ui/Icon';
import { formatDateTime } from '@/lib/format';

/**
 * ADMIN BOOKINGS LIST
 *
 * The dispatch queue's read side: every booking in the database, with search,
 * a status filter and real server-side pagination. Clicking a row opens the full
 * booking record at `/admin/bookings/[id]`, where confirmation and technician
 * assignment happen — this table stays read-only, so no control here can start a
 * state transition the server would reject.
 *
 * EVERYTHING SHOWN IS READ FROM THE DATABASE through `listAllBookings`, whose
 * projection is explicit - no customer phone, email or street address is
 * fetched, so none can reach the browser.
 *
 * Search and filters are a plain GET form and paging is real links, so the
 * whole view is expressible as a URL: it can be bookmarked, shared, and reached
 * with the back button, without a second copy of the queue in the browser.
 *
 * The page re-checks the admin role server-side in addition to the layout guard.
 */
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage('/admin/bookings');

  // `.strict()` means an unrecognised query parameter is rejected rather than
  // forwarded into a database filter; a bad query falls back to the defaults.
  const raw = normaliseSearchParams(await searchParams);
  const parsed = adminBookingQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : adminBookingQuerySchema.parse({});

  let rows: Awaited<ReturnType<typeof listAllBookings>>;
  try {
    rows = await listAllBookings({
      q: query.q,
      status: query.status === 'ALL' ? undefined : query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch {
    return (
      <div className="space-y-6">
        <PageHeader title="Bookings" description="The dispatch queue: every booking, newest first." />
        <ErrorState description="The booking list could not be loaded. Please try again." />
      </div>
    );
  }

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.status !== 'ALL') params.set('status', query.status);
    params.set('page', String(page));
    return `/admin/bookings?${params.toString()}`;
  };

  const hasFilters = Boolean(query.q) || query.status !== 'ALL';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bookings"
        description="The dispatch queue: every booking, newest first. Open a booking to confirm it, assign a technician and review its full history."
        actions={
          rows.awaitingTotal > 0 ? (
            <Link
              href="/admin/bookings?status=REQUESTED"
              className="inline-flex items-center gap-1.5 rounded-lg bg-warning-bg px-3 py-2 text-sm font-semibold text-warning ring-1 ring-inset ring-warning/25 transition hover:bg-warning/10"
            >
              <Icon name="clock" size={15} />
              {rows.awaitingTotal} awaiting confirmation
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-success-bg px-3 py-2 text-sm font-semibold text-success ring-1 ring-inset ring-success/20">
              <Icon name="check-circle" size={15} />
              No booking is waiting on confirmation
            </span>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <QueueStat label="In the queue" value={rows.awaitingTotal} hint="Status Requested" />
        <QueueStat label="Matching this view" value={rows.total} hint="After search and filters" />
        <QueueStat label="On this page" value={rows.items.length} hint={`Page ${query.page}`} />
      </div>

      <Toolbar action="/admin/bookings" query={{ pageSize: String(PAGE_SIZE) }}>
        <SearchField
          name="q"
          label="Search"
          defaultValue={query.q ?? ''}
          placeholder="Reference, e.g. SERIC-2026-000123"
        />
        <SelectField
          name="status"
          label="Status"
          defaultValue={query.status}
          options={[
            { value: 'ALL', label: 'All statuses' },
            ...BOOKING_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
          ]}
        />
      </Toolbar>

      {hasFilters && (
        <Notice tone="neutral">
          Showing a filtered view.{' '}
          <Link href="/admin/bookings" className="font-semibold underline underline-offset-2">
            Clear search and filters
          </Link>
          .
        </Notice>
      )}


      <DataTable
        caption="Bookings with reference, status, service, customer, technician and creation time"
        rows={rows.items}
        rowKey={(r) => r.id}
        rowHref={(r) => `/admin/bookings/${r.id}`}
        rowLabel={(r) => `Open booking ${r.reference}`}
        empty={
          <EmptyState
            icon="clipboard"
            title={hasFilters ? 'No bookings match these filters' : 'No bookings yet'}
            description={
              hasFilters
                ? 'Try clearing the search or choosing a different status.'
                : 'Bookings appear here as customers place them.'
            }
          />
        }
        columns={[
          {
            key: 'reference',
            header: 'Reference',
            className: 'w-48',
            cell: (r) => (
              <div className="min-w-0">
                <span className="font-mono text-xs font-semibold text-ink-800 group-hover:text-brand-700">
                  {r.reference}
                </span>
                <p className="truncate text-xs text-ink-400">{formatDateTime(r.createdAt)}</p>
              </div>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            className: 'w-44',
            cell: (r) => (
              <StatusBadge
                label={STATUS_LABEL[r.status as keyof typeof STATUS_LABEL] ?? r.status}
                tone={toneForStatus(r.status)}
                dot
              />
            ),
          },
          {
            key: 'service',
            header: 'Service',
            cell: (r) => (
              <div className="min-w-0">
                <p className="truncate font-medium text-ink-900">{r.service.name}</p>
                <p className="truncate text-xs text-ink-400">
                  {r.area}
                  {r.city ? `, ${r.city}` : ''}
                </p>
              </div>
            ),
          },
          {
            key: 'customer',
            header: 'Customer',
            cell: (r) => <span className="truncate">{r.customer.name}</span>,
          },
          {
            key: 'technician',
            header: 'Technician',
            className: 'w-48',
            cell: (r) =>
              r.technician ? (
                <span className="inline-flex items-center gap-1.5 truncate text-ink-800">
                  <Icon name="user" size={13} className="shrink-0 text-ink-400" />
                  {r.technician.displayName}
                </span>
              ) : (
                <span className="text-xs text-ink-400">Not assigned</span>
              ),
          },
          {
            key: 'mode',
            header: 'Mode',
            className: 'w-28',
            secondary: true,
            cell: (r) => (
              <span className="text-xs font-medium text-ink-600">
                {MODE_LABEL[r.mode as BookingMode] ?? r.mode}
              </span>
            ),
          },
          {
            key: 'open',
            header: <span className="sr-only">Open</span>,
            className: 'w-10',
            cell: () => (
              <Icon
                name="chevron-right"
                size={16}
                className="ml-auto text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600 motion-reduce:transition-none"
              />
            ),
          },
        ]}
      />

      <Pager page={query.page} pageSize={query.pageSize} total={rows.total} buildHref={buildHref} />
    </div>
  );
}

/** Small count tile above the queue. Values are real query results only. */
function QueueStat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-card border border-ink-200 bg-white px-4 py-3 shadow-card">
      <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold tabular-nums leading-none text-ink-900">{value}</p>
      <p className="mt-1 truncate text-[11px] text-ink-400">{hint}</p>
    </div>
  );
}

