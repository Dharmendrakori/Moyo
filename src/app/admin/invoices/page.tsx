import Link from 'next/link';
import { requireAdminPage } from '@/lib/admin-page-guard';
import { invoiceStatusLabel, listInvoices } from '@/lib/invoice';
import { adminInvoiceQuerySchema, normaliseSearchParams } from '@/lib/validation';
import { INVOICE_STATUSES } from '@/lib/domain';
import { DataTable, Notice, PageHeader } from '@/components/admin/DataTable';
import { Pager, SearchField, SelectField, Toolbar } from '@/components/admin/Toolbar';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatCard, StatusBadge, toneForStatus } from '@/components/ui/StatusBadge';
import { formatDate, formatINR } from '@/lib/format';
import { Icon } from '@/components/ui/Icon';

/**
 * ADMIN INVOICES
 *
 * The issued-invoice ledger: every invoice in the database, newest first, with
 * number / booking-reference / customer search, a status filter and real
 * server-side pagination. Clicking a row opens the full invoice.
 *
 * Everything shown is read through `listInvoices`, whose projection carries no
 * contact details and no snapshot bodies - a table row is the worst place to
 * expose a customer's address.
 *
 * Search and filters are a plain GET form and paging is real links, so the whole
 * view is expressible as a URL. The page re-checks the admin role server-side on
 * top of the layout guard.
 */
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function AdminInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage('/admin/invoices');

  // `.strict()` rejects an unrecognised parameter rather than forwarding it into
  // a database filter; a bad query falls back to the defaults.
  const raw = normaliseSearchParams(await searchParams);
  const parsed = adminInvoiceQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : adminInvoiceQuerySchema.parse({});

  let ledger: Awaited<ReturnType<typeof listInvoices>>;
  try {
    ledger = await listInvoices({
      q: query.q,
      status: query.status === 'ALL' ? undefined : query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Invoices"
          description="Every invoice issued from a completed booking, newest first."
        />
        <ErrorState description="The invoice ledger could not be loaded. Please try again." />
      </div>
    );
  }

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.status !== 'ALL') params.set('status', query.status);
    params.set('page', String(page));
    return `/admin/invoices?${params.toString()}`;
  };

  const hasFilters = Boolean(query.q) || query.status !== 'ALL';


  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Every invoice issued from a completed booking, newest first. Open one to review its line items and download the PDF."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Issued"
          value={ledger.issuedTotal}
          hint="Status Issued, whole ledger"
          icon="receipt"
          tone="brand"
        />
        <StatCard
          label="Matching this view"
          value={ledger.total}
          hint="After search and filters"
          icon="filter"
        />
        <StatCard
          label="On this page"
          value={ledger.items.length}
          hint={`Page ${query.page}`}
          icon="list"
        />
      </div>

      <Toolbar action="/admin/invoices" query={{ pageSize: String(PAGE_SIZE) }}>
        <SearchField
          name="q"
          label="Search"
          defaultValue={query.q ?? ''}
          placeholder="Invoice number, booking reference or customer"
        />
        <SelectField
          name="status"
          label="Status"
          defaultValue={query.status}
          options={[
            { value: 'ALL', label: 'All statuses' },
            ...INVOICE_STATUSES.map((s) => ({ value: s, label: invoiceStatusLabel(s) })),
          ]}
        />
      </Toolbar>

      {hasFilters && (
        <Notice tone="neutral">
          Showing a filtered view.{' '}
          <Link href="/admin/invoices" className="font-semibold underline underline-offset-2">
            Clear search and filters
          </Link>
          .
        </Notice>
      )}

      <DataTable
        caption="Invoices with number, booking reference, customer, issue date, status and amount"
        rows={ledger.items}
        rowKey={(r) => r.id}
        rowHref={(r) => `/admin/invoices/${r.id}`}
        rowLabel={(r) => `Open invoice ${r.number}`}
        empty={
          <EmptyState
            icon="receipt"
            title={hasFilters ? 'No invoices match these filters' : 'No invoices yet'}
            description={
              hasFilters
                ? 'Try clearing the search or choosing a different status.'
                : 'Invoices appear here when one is issued from a completed booking.'
            }
          />
        }
        columns={[
          {
            key: 'number',
            header: 'Invoice',
            className: 'w-56',
            cell: (r) => (
              <div className="min-w-0">
                <span className="font-mono text-xs font-semibold text-ink-800 group-hover:text-brand-700">
                  {r.number}
                </span>
                <p className="truncate text-xs text-ink-400">
                  {r.issuedAt ? formatDate(r.issuedAt) : 'Not issued'}
                </p>
              </div>
            ),
          },
          {
            key: 'booking',
            header: 'Booking',
            className: 'w-48',
            cell: (r) => (
              <span className="font-mono text-xs text-ink-700">{r.booking.reference}</span>
            ),
          },
          {
            key: 'customer',
            header: 'Customer',
            cell: (r) => <span className="truncate">{r.customer.name}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            className: 'w-32',
            secondary: true,
            cell: (r) => <StatusBadge label={r.statusLabel} tone={toneForStatus(r.status)} dot />,
          },
          {
            key: 'amount',
            header: 'Amount',
            className: 'w-32',
            numeric: true,
            cell: (r) => (
              <span className="font-semibold text-ink-900">{formatINR(r.totalPaise)}</span>
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

      <Pager page={query.page} pageSize={query.pageSize} total={ledger.total} buildHref={buildHref} />
    </div>
  );
}
