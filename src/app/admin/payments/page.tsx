import Link from 'next/link';
import { requireAdminPage } from '@/lib/admin-page-guard';
import { listPayments, paymentStatusLabel } from '@/lib/payments/ledger';
import { adminPaymentQuerySchema, normaliseSearchParams } from '@/lib/validation';
import { PAYMENT_STATUSES } from '@/lib/domain';
import { DataTable, Notice, PageHeader } from '@/components/admin/DataTable';
import { Pager, SearchField, SelectField, Toolbar } from '@/components/admin/Toolbar';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StatCard, StatusBadge, toneForStatus } from '@/components/ui/StatusBadge';
import { formatDate, formatINR } from '@/lib/format';
import { Icon } from '@/components/ui/Icon';

/**
 * ADMIN PAYMENTS
 *
 * The payment ledger: every attempt in the database, newest first, with search
 * across the payment reference, invoice number, booking reference and customer,
 * a status filter and real server-side pagination.
 *
 * READ-ONLY BY CONSTRUCTION. No administrative action on this screen can mark a
 * payment successful, change an amount or edit a gateway reference - those
 * values only ever arrive from a verified gateway response. The tile figures are
 * database aggregates, not mock metrics.
 */
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage('/admin/payments');

  const raw = normaliseSearchParams(await searchParams);
  const parsed = adminPaymentQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : adminPaymentQuerySchema.parse({});

  let ledger: Awaited<ReturnType<typeof listPayments>>;
  try {
    ledger = await listPayments({
      q: query.q,
      status: query.status === 'ALL' ? undefined : query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Payments"
          description="Every online payment attempt, settled through signature-verified gateway responses."
        />
        <ErrorState description="The payment ledger could not be loaded. Please try again." />
      </div>
    );
  }

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.status !== 'ALL') params.set('status', query.status);
    params.set('page', String(page));
    return `/admin/payments?${params.toString()}`;
  };

  const hasFilters = Boolean(query.q) || query.status !== 'ALL';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Every online payment attempt. A payment reads as paid only after a signature-verified gateway response confirmed the capture."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Captured"
          value={ledger.capturedTotal}
          hint={`${formatINR(ledger.capturedPaise)} collected, whole ledger`}
          icon="wallet"
          tone="success"
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

      <Toolbar action="/admin/payments" query={{ pageSize: String(PAGE_SIZE) }}>
        <SearchField
          name="q"
          label="Search"
          defaultValue={query.q ?? ''}
          placeholder="Payment id, order id, invoice, booking or customer"
        />
        <SelectField
          name="status"
          label="Status"
          defaultValue={query.status}
          options={[
            { value: 'ALL', label: 'All statuses' },
            ...PAYMENT_STATUSES.map((s) => ({ value: s, label: paymentStatusLabel(s) })),
          ]}
        />
      </Toolbar>

      {hasFilters && (
        <Notice tone="neutral">
          Showing a filtered view.{' '}
          <Link href="/admin/payments" className="font-semibold underline underline-offset-2">
            Clear search and filters
          </Link>
          .
        </Notice>
      )}

      <DataTable
        caption="Payments with reference, invoice, booking, customer, amount, gateway, status and dates"
        rows={ledger.items}
        rowKey={(r) => r.id}
        rowHref={(r) => `/admin/payments/${r.id}`}
        rowLabel={(r) => `Open payment ${r.gatewayPaymentId ?? r.id}`}
        empty={
          <EmptyState
            icon="wallet"
            title={hasFilters ? 'No payments match these filters' : 'No payments yet'}
            description={
              hasFilters
                ? 'Try clearing the search or choosing a different status.'
                : 'Payments appear here when a customer pays an issued invoice.'
            }
          />
        }
        columns={[
          {
            key: 'reference',
            header: 'Payment',
            className: 'w-56',
            cell: (r) => (
              <div className="min-w-0">
                <span className="block truncate font-mono text-xs font-semibold text-ink-800 group-hover:text-brand-700">
                  {r.gatewayPaymentId ?? 'Not captured'}
                </span>
                <p className="truncate font-mono text-[11px] text-ink-400">
                  {r.gatewayOrderId ?? r.id}
                </p>
              </div>
            ),
          },
          {
            key: 'invoice',
            header: 'Invoice',
            className: 'w-44',
            cell: (r) => <span className="font-mono text-xs text-ink-700">{r.invoice.number}</span>,
          },
          {
            key: 'booking',
            header: 'Booking',
            className: 'w-40',
            secondary: true,
            cell: (r) => (
              <span className="font-mono text-xs text-ink-600">{r.booking.reference}</span>
            ),
          },
          {
            key: 'customer',
            header: 'Customer',
            secondary: true,
            cell: (r) => <span className="truncate">{r.customer.name}</span>,
          },
          {
            key: 'amount',
            header: 'Amount',
            className: 'w-28',
            numeric: true,
            cell: (r) => (
              <span className="font-semibold text-ink-900">{formatINR(r.amountPaise)}</span>
            ),
          },
          {
            key: 'gateway',
            header: 'Gateway',
            className: 'w-28',
            secondary: true,
            cell: (r) => <span className="text-xs text-ink-600">{r.provider}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            className: 'w-40',
            cell: (r) => (
              <div className="space-y-1">
                <StatusBadge label={r.statusLabel} tone={toneForStatus(r.status)} dot />
                {r.refundedPaise > 0 && (
                  <p className="text-[11px] text-ink-500">
                    {formatINR(r.refundedPaise)} refunded
                    {r.refundStatus ? ` · ${r.refundStatus.toLowerCase()}` : ''}
                  </p>
                )}
              </div>
            ),
          },
          {
            key: 'dates',
            header: 'Created',
            className: 'w-32',
            secondary: true,
            cell: (r) => (
              <div className="min-w-0">
                <span className="block text-xs text-ink-600">{formatDate(r.createdAt)}</span>
                {r.verifiedAt && (
                  <span className="block text-[11px] text-ink-400">
                    Verified {formatDate(r.verifiedAt)}
                  </span>
                )}
              </div>
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
