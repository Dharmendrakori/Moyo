import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/admin-page-guard';
import { getPaymentById, paymentStatusLabel } from '@/lib/payments/ledger';
import { invoiceStatusLabel } from '@/lib/invoice';
import { formatDateTime, formatINR } from '@/lib/format';
import { Notice, Panel } from '@/components/admin/DataTable';
import { StatusBadge, toneForStatus } from '@/components/ui/StatusBadge';
import { Icon } from '@/components/ui/Icon';

export const metadata: Metadata = {
  title: 'Payment',
  robots: { index: false, follow: false },
};

/** Always read the live record: a cached financial state is a risk. */
export const dynamic = 'force-dynamic';

/**
 * ADMIN PAYMENT DETAIL
 *
 * One payment attempt: what it is for, what the gateway reported, and what
 * failed if anything did. It is a record view, not a control panel - there is no
 * button here that can mark a payment successful, alter an amount or edit a
 * gateway reference. Those facts belong to the gateway.
 *
 * `requireAdminPage()` re-checks the ADMIN role for this page itself, on top of
 * the admin layout guard.
 */
export default async function AdminPaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage('/admin/payments');

  const { id } = await params;
  const payment = await getPaymentById(id);
  if (!payment) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/admin/payments"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 transition hover:text-brand-600"
      >
        <Icon name="chevron-left" size={14} />
        All payments
      </Link>

      <header className="flex flex-col gap-4 border-b border-ink-200 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold tracking-wide text-ink-500">
            {payment.gatewayPaymentId ?? payment.id}
          </p>
          <h1 className="mt-1.5 text-[22px] font-bold leading-tight tracking-tight text-ink-900">
            {formatINR(payment.amountPaise)}{' '}
            <span className="text-sm font-medium text-ink-400">{payment.currency}</span>
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="font-medium text-ink-600">Status</span>
              <StatusBadge
                label={paymentStatusLabel(payment.status)}
                tone={toneForStatus(payment.status)}
                dot
              />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="receipt" size={13} className="text-ink-400" />
              <Link
                href={`/admin/invoices/${payment.invoice.id}`}
                className="font-mono text-brand-700 hover:underline"
              >
                {payment.invoice.number}
              </Link>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="clipboard" size={13} className="text-ink-400" />
              <Link
                href={`/admin/bookings/${payment.booking.id}`}
                className="font-mono text-brand-700 hover:underline"
              >
                {payment.booking.reference}
              </Link>
            </span>
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Transaction" description="As recorded by this application.">
          <dl className="space-y-3">
            <Field label="Payment record">
              <span className="font-mono text-xs">{payment.id}</span>
            </Field>
            <Field label="Provider">{payment.provider}</Field>
            <Field label="Amount">{formatINR(payment.amountPaise)}</Field>
            <Field label="Currency">{payment.currency}</Field>
            <Field label="Customer">{payment.customerName ?? 'Not recorded'}</Field>
            <Field label="Invoice">
              <Link
                href={`/admin/invoices/${payment.invoice.id}`}
                className="font-mono text-brand-700 hover:underline"
              >
                {payment.invoice.number}
              </Link>{' '}
              <span className="text-ink-500">
                ({invoiceStatusLabel(payment.invoice.status)} ·{' '}
                {formatINR(payment.invoice.totalPaise)})
              </span>
            </Field>
            <Field label="Booking">
              <Link
                href={`/admin/bookings/${payment.booking.id}`}
                className="font-mono text-brand-700 hover:underline"
              >
                {payment.booking.reference}
              </Link>
            </Field>
          </dl>
          <p className="mt-3 border-t border-ink-100 pt-3 text-[11px] leading-relaxed text-ink-400">
            Payment amounts come from the invoice and are confirmed against the gateway. No
            administrator can change an amount, a status or a gateway reference.
          </p>
        </Panel>

        <div className="space-y-5">
          <Panel title="Gateway references">
            <dl className="space-y-3">
              <Field label="Order id">
                <span className="font-mono text-xs">{payment.gatewayOrderId ?? 'Not created'}</span>
              </Field>
              <Field label="Payment id">
                <span className="font-mono text-xs">
                  {payment.gatewayPaymentId ?? 'Not received'}
                </span>
              </Field>
              <Field label="Signature verified">{payment.signatureVerified ? 'Yes' : 'No'}</Field>
              <Field label="Verified at">
                {payment.verifiedAt ? formatDateTime(payment.verifiedAt) : 'Not verified'}
              </Field>
              <Field label="Created">{formatDateTime(payment.createdAt)}</Field>
              <Field label="Updated">{formatDateTime(payment.updatedAt)}</Field>
            </dl>
          </Panel>

          <Panel title="Failure">
            {payment.failureCode || payment.failureReason ? (
              <dl className="space-y-3">
                <Field label="Code">{payment.failureCode ?? 'Not reported'}</Field>
                <Field label="Description">{payment.failureReason ?? 'Not reported'}</Field>
              </dl>
            ) : (
              <p className="text-sm text-ink-600">
                No failure has been reported for this payment by the gateway.
              </p>
            )}
          </Panel>

          <Panel title="Refund">
            {payment.refundedPaise > 0 || payment.refundStatus ? (
              <dl className="space-y-3">
                <Field label="Refunded">{formatINR(payment.refundedPaise)}</Field>
                <Field label="Gateway status">{payment.refundStatus ?? 'Not reported'}</Field>
              </dl>
            ) : (
              <p className="text-sm text-ink-600">No refund has been reported for this payment.</p>
            )}
            <div className="mt-3">
              <Notice tone="neutral">
                Refunds are not initiated from this console yet: the refund policy has not been
                approved. The status shown here is what the payment provider reports.
              </Notice>
            </div>
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
