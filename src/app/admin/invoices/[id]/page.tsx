import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/admin-page-guard';
import {
  chargingLabel,
  getInvoiceById,
  invoiceStatusLabel,
  parseCustomerSnapshot,
  parseSellerSnapshot,
} from '@/lib/invoice';
import { formatDate, formatDateTime, formatINR } from '@/lib/format';
import { Notice, Panel } from '@/components/admin/DataTable';
import { StatusBadge, toneForStatus } from '@/components/ui/StatusBadge';
import { Icon } from '@/components/ui/Icon';

export const metadata: Metadata = {
  title: 'Invoice',
  robots: { index: false, follow: false },
};

/** Always read the live record: a cached financial document is a risk. */
export const dynamic = 'force-dynamic';

/**
 * ADMIN INVOICE DETAIL
 *
 * One issued invoice, exactly as it was written: line items, totals, and the
 * seller and customer blocks read back from the stored SNAPSHOTS. Nothing here
 * is re-priced from the current catalogue, which is what makes the document
 * reproducible.
 *
 * AUTHORIZATION. `requireAdminPage()` re-checks the ADMIN role for this page
 * itself, on top of the admin layout guard, and the PDF is served by an
 * independently guarded endpoint. Hiding this page would protect nothing.
 */
export default async function AdminInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage('/admin/invoices');

  const { id } = await params;
  const invoice = await getInvoiceById(id);
  if (!invoice) notFound();

  const seller = parseSellerSnapshot(invoice.sellerSnapshot);
  const customer = parseCustomerSnapshot(invoice.customerSnapshot);

  return (
    <div className="space-y-6">
      <Link
        href="/admin/invoices"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 transition hover:text-brand-600"
      >
        <Icon name="chevron-left" size={14} />
        All invoices
      </Link>

      <header className="flex flex-col gap-4 border-b border-ink-200 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold tracking-wide text-ink-500">
            {invoice.number}
          </p>
          <h1 className="mt-1.5 text-[22px] font-bold leading-tight tracking-tight text-ink-900">
            {formatINR(invoice.totalPaise)}{' '}
            <span className="text-sm font-medium text-ink-400">{invoice.currency}</span>
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="font-medium text-ink-600">Status</span>
              <StatusBadge
                label={invoiceStatusLabel(invoice.status)}
                tone={toneForStatus(invoice.status)}
                dot
              />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="calendar" size={13} className="text-ink-400" />
              {invoice.issuedAt ? `Issued ${formatDate(invoice.issuedAt)}` : 'Not issued'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="clipboard" size={13} className="text-ink-400" />
              <Link
                href={`/admin/bookings/${invoice.booking.id}`}
                className="font-mono font-medium text-brand-700 hover:underline"
              >
                {invoice.booking.reference}
              </Link>
            </span>
          </div>
        </div>

        <a
          href={`/api/admin/invoices/${invoice.id}/pdf`}
          download
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-700 active:bg-brand-800"
        >
          <Icon name="download" size={15} />
          Download PDF
        </a>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="Line items" description="Snapshotted when the invoice was issued.">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <caption className="sr-only">
                  Invoice line items with description, charging option, quantity, unit price and
                  amount
                </caption>
                <thead>
                  <tr className="border-b border-ink-200">
                    <th
                      scope="col"
                      className="py-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-ink-500"
                    >
                      Description
                    </th>
                    <th
                      scope="col"
                      className="w-16 px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-500"
                    >
                      Qty
                    </th>
                    <th
                      scope="col"
                      className="w-32 px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-500"
                    >
                      Unit price
                    </th>
                    <th
                      scope="col"
                      className="w-32 py-2 pl-4 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-500"
                    >
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {invoice.lineItems.map((line) => (
                    <tr key={line.id}>
                      <td className="py-3 pr-4 align-top">
                        <p className="font-medium text-ink-900">{line.description}</p>
                        <p className="mt-0.5 text-xs text-ink-400">
                          {chargingLabel(line.charging) || 'Charging option not recorded'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right align-top tabular-nums text-ink-700">
                        {line.quantity}
                      </td>
                      <td className="px-4 py-3 text-right align-top tabular-nums text-ink-700">
                        {formatINR(line.unitPaise)}
                      </td>
                      <td className="py-3 pl-4 text-right align-top font-semibold tabular-nums text-ink-900">
                        {formatINR(line.amountPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="mt-4 space-y-2 border-t border-ink-100 pt-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-ink-500">Subtotal</dt>
                <dd className="tabular-nums text-ink-800">{formatINR(invoice.subtotalPaise)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-ink-500">Tax</dt>
                <dd className="tabular-nums text-ink-800">
                  {invoice.taxPaise > 0 ? formatINR(invoice.taxPaise) : 'Not applied'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-ink-200 pt-2">
                <dt className="font-semibold text-ink-900">Total</dt>
                <dd className="text-base font-bold tabular-nums text-ink-900">
                  {formatINR(invoice.totalPaise)}{' '}
                  <span className="text-xs font-medium text-ink-400">{invoice.currency}</span>
                </dd>
              </div>
            </dl>

            <div className="mt-4">
              <Notice tone="neutral">
                No tax has been applied: this deployment has no verified tax registration or tax
                rule configured, so none is calculated or implied.
              </Notice>
            </div>
          </Panel>
        </div>


        <div className="space-y-5">
          <Panel title="Seller" description="As recorded when the invoice was issued.">
            <dl className="space-y-3">
              <Field label="Business name">{seller.name || 'Not recorded'}</Field>
              {seller.legalName && seller.legalName !== seller.name && (
                <Field label="Legal name">{seller.legalName}</Field>
              )}
              <Field label="Address">{seller.address || 'Not recorded'}</Field>
              <Field label="Email">{seller.email || 'Not recorded'}</Field>
              <Field label="Phone">{seller.phone || 'Not recorded'}</Field>
              <Field label="Tax registration">{seller.gstin || 'None configured'}</Field>
            </dl>
          </Panel>

          <Panel title="Billed to">
            <dl className="space-y-3">
              <Field label="Name">{customer.name || 'Not recorded'}</Field>
              <Field label="Contact">
                {[customer.contactName, customer.contactPhone].filter(Boolean).join(' · ') ||
                  'Not recorded'}
              </Field>
              <Field label="Billing address">{customer.address || 'Not recorded'}</Field>
            </dl>
          </Panel>

          <Panel title="Record">
            <dl className="space-y-3">
              <Field label="Invoice number">
                <span className="font-mono">{invoice.number}</span>
              </Field>
              <Field label="Booking reference">
                <Link
                  href={`/admin/bookings/${invoice.booking.id}`}
                  className="font-mono text-brand-700 hover:underline"
                >
                  {invoice.booking.reference}
                </Link>
              </Field>
              <Field label="Created">{formatDateTime(invoice.createdAt)}</Field>
              <Field label="Issued">
                {invoice.issuedAt ? formatDateTime(invoice.issuedAt) : 'Not issued'}
              </Field>
              <Field label="Customer account">{invoice.customer.name}</Field>
            </dl>
            <p className="mt-3 border-t border-ink-100 pt-3 text-[11px] leading-relaxed text-ink-400">
              An issued invoice is immutable. Its figures, seller details and customer details are
              the snapshots written at issue time, so changing a service price or a profile later
              cannot alter this document.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** One labelled value. Keeps every detail block visually identical. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">{label}</dt>
      <dd className="mt-1 break-words text-sm text-ink-800">{children}</dd>
    </div>
  );
}

