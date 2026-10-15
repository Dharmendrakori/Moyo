import { requireAdminPage } from '@/lib/admin-page-guard';
import { listAllBookings } from '@/lib/customer-bookings';
import { adminBookingQuerySchema } from '@/lib/validation';
import { BOOKING_STATUSES } from '@/lib/domain';
import { STATUS_LABEL } from '@/lib/booking-state';
import { DataTable, Notice, PageHeader } from '@/components/admin/DataTable';
import { Pager, SearchField, SelectField, Toolbar } from '@/components/admin/Toolbar';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatusBadge, toneForStatus } from '@/components/ui/StatusBadge';
import { formatDateTime } from '@/lib/format';

/**
 * ADMIN BOOKINGS LIST
 *
 * The dispatch queue's read side: every booking in the database, with search,
 * a status filter and real server-side pagination.
 *
 * EVERYTHING SHOWN IS READ FROM THE DATABASE through `listAllBookings`, whose
 * projection is explicit - no customer phone, email or street address is
 * fetched, so none can reach the browser. This screen is read-only; confirming
 * a booking or assigning a technician is a separate, audited mutation that has
 * not been built yet, and no control here pretends otherwise.
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
  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
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
  const awaitingOnPage = rows.items.filter((r) => r.status === 'REQUESTED').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bookings"
        description="The dispatch queue: every booking, newest first. Search by reference, filter by status, and page through history."
      />

      <Toolbar action="/admin/bookings" query={{ pageSize: String(PAGE_SIZE) }}>
        <SearchField
          name="q"
          label="Search"
          defaultValue={query.q ?? ''}
          placeholder="Reference, e.g. MOYO-2026-000123"
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

      {awaitingOnPage > 0 && (
        <Notice tone="warning">
          {awaitingOnPage} booking{awaitingOnPage === 1 ? '' : 's'} on this page{' '}
          {awaitingOnPage === 1 ? 'is' : 'are'} still awaiting confirmation.
        </Notice>
      )}

      <DataTable
        caption="Bookings with reference, status, service, customer and creation time"
        rows={rows.items}
        rowKey={(r) => r.id}
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
            className: 'w-44',
            cell: (r) => (
              <div className="min-w-0">
                <span className="font-mono text-xs font-semibold text-ink-700">{r.reference}</span>
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
            className: 'w-44',
            cell: (r) =>
              r.technician ? (
                <span className="truncate">{r.technician.displayName}</span>
              ) : (
                <span className="text-xs text-ink-400">Not assigned</span>
              ),
          },
          {
            key: 'mode',
            header: 'Mode',
            className: 'w-28',
            secondary: true,
            cell: (r) => <span className="text-xs font-medium text-ink-600">{r.mode}</span>,
          },
        ]}
      />

      <Pager page={query.page} pageSize={query.pageSize} total={rows.total} buildHref={buildHref} />
    </div>
  );
}
