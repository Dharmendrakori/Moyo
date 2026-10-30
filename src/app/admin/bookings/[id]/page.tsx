import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/admin-page-guard';
import { getAdminBookingDetail } from '@/lib/customer-bookings';
import { projectLifecycle, summarisePrice } from '@/lib/booking-tracking';
import { STATUS_HINT, STATUS_LABEL } from '@/lib/booking-state';
import {
  CHARGING_LABEL,
  MODE_LABEL,
  ROLE_LABEL,
  SERVICE_TYPE_LABEL,
  type BookingMode,
  type ChargingOption,
  type Role,
  type ServiceType,
} from '@/lib/domain';
import { formatDate, formatDateTime, formatINR, telLink } from '@/lib/format';
import { Notice, Panel } from '@/components/admin/DataTable';
import { StatusBadge, toneForStatus } from '@/components/ui/StatusBadge';
import { Icon } from '@/components/ui/Icon';
import { ConfirmBookingButton } from '@/components/admin/bookings/ConfirmBookingButton';
import { AssignTechnicianDialog } from '@/components/admin/bookings/AssignTechnicianDialog';
import { GenerateInvoiceButton } from '@/components/admin/bookings/GenerateInvoiceButton';
import { assessInvoiceEligibility, invoiceStatusLabel } from '@/lib/invoice';

export const metadata: Metadata = {
  title: 'Booking details',
  robots: { index: false, follow: false },
};

/** Always read the live record: a cached dispatch view is a safety problem. */
export const dynamic = 'force-dynamic';

/**
 * ADMIN BOOKING DETAIL
 *
 * The complete operational record for one booking, plus the two administrative
 * actions that exist: confirm a requested booking, and assign a technician to a
 * confirmed one.
 *
 * AUTHORIZATION. `requireAdminPage()` re-checks the role on the server for this
 * page itself, on top of the admin layout guard, and the data comes from an
 * admin-only query. The actions post to `/api/admin/bookings/:id/...`, whose
 * guard chain (`assertSameOrigin → requireAdmin → assertCsrf → rate limit`) and
 * booking state machine re-decide everything server-side. Nothing on this page
 * is a trust boundary: hiding a button would change no access decision.
 *
 * HONESTY. Every value is persisted data. The lifecycle section renders the
 * append-only `BookingStatusEvent` log for what actually happened and labels
 * later stages as not yet recorded - it never invents a timestamp. The pricing
 * section keeps a published estimate and a final invoice visually and verbally
 * distinct, and never presents an estimate as an amount payable.
 */
export default async function AdminBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage('/admin/bookings');

  const { id } = await params;
  // A malformed id simply matches no row; it never becomes a query fragment.
  const booking = await getAdminBookingDetail(id);
  if (!booking) notFound();

  const lifecycle = projectLifecycle(booking.status);
  const price = summarisePrice({
    charging: booking.charging,
    quotedPaise: booking.quotedPaise,
    budgetMinPaise: booking.budgetMinPaise,
    budgetMaxPaise: booking.budgetMaxPaise,
  });

  const statusLabel = STATUS_LABEL[booking.status as keyof typeof STATUS_LABEL] ?? booking.status;
  const statusHint = STATUS_HINT[booking.status as keyof typeof STATUS_HINT] ?? '';
  const modeLabel = MODE_LABEL[booking.mode as BookingMode] ?? booking.mode;
  const chargeLabel = CHARGING_LABEL[booking.charging as ChargingOption] ?? booking.charging;
  const serviceTypeLabel =
    SERVICE_TYPE_LABEL[booking.service.serviceType as ServiceType] ??
    SERVICE_TYPE_LABEL[booking.serviceType as ServiceType] ??
    booking.serviceType;

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

  const canConfirm = booking.status === 'REQUESTED';
  const canAssign = booking.status === 'CONFIRMED' && !booking.technician;

  // Invoicing is decided by the same pure rule the API enforces, so this page can
  // never offer an action the server would refuse.
  const invoiceEligibility = assessInvoiceEligibility({
    status: booking.status,
    charging: booking.charging,
    quotedPaise: booking.quotedPaise,
    hasInvoice: Boolean(booking.invoice),
    hasSeller: Boolean(booking.provider),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/admin/bookings"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 transition hover:text-brand-600"
        >
          <Icon name="chevron-left" size={14} />
          All bookings
        </Link>
        {booking.isEmergency && (
          <StatusBadge label="Emergency request" tone="danger" icon="alert-triangle" />
        )}
      </div>

      <header className="flex flex-col gap-4 border-b border-ink-200 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold tracking-wide text-ink-500">
            {booking.reference}
          </p>
          <h1 className="mt-1.5 text-[22px] font-bold leading-tight tracking-tight text-ink-900">
            {booking.service.name}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {booking.service.subCategory.category.name} &middot;{' '}
            {booking.service.subCategory.name} &middot; {serviceTypeLabel}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="font-medium text-ink-600">Status</span>
              <StatusBadge label={statusLabel} tone={toneForStatus(booking.status)} dot />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="clock" size={13} className="text-ink-400" />
              {modeLabel}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="calendar" size={13} className="text-ink-400" />
              {booking.scheduledFor
                ? `Scheduled ${formatDateTime(booking.scheduledFor)}`
                : 'No scheduled slot requested'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="clipboard" size={13} className="text-ink-400" />
              Created {formatDateTime(booking.createdAt)}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <ConfirmBookingButton
            booking={{ id: booking.id, reference: booking.reference, status: booking.status }}
          />
          <AssignTechnicianDialog
            booking={{
              id: booking.id,
              reference: booking.reference,
              status: booking.status,
              technician: booking.technician
                ? { id: booking.technician.id, displayName: booking.technician.displayName }
                : null,
            }}
          />
          {invoiceEligibility.eligible && (
            <GenerateInvoiceButton
              booking={{ id: booking.id, reference: booking.reference }}
              amountLabel={formatINR(booking.quotedPaise ?? 0)}
            />
          )}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="Booking information" description="What the customer asked for, as stored.">
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Field label="Booking reference">
                <span className="font-mono">{booking.reference}</span>
              </Field>
              <Field label="Status">
                <StatusBadge label={statusLabel} tone={toneForStatus(booking.status)} dot />
              </Field>
              <Field label="Created">{formatDateTime(booking.createdAt)}</Field>
              <Field label="Last updated">{formatDateTime(booking.updatedAt)}</Field>
              <Field label="Booking mode">{modeLabel}</Field>
              <Field label="Requested service date">
                {booking.scheduledFor ? formatDateTime(booking.scheduledFor) : 'Not scheduled'}
              </Field>
              <Field label="Service">{booking.service.name}</Field>
              <Field label="Service category">
                {booking.service.subCategory.category.name} &middot;{' '}
                {booking.service.subCategory.name}
              </Field>
              <Field label="Service type">{serviceTypeLabel}</Field>
              <Field label="Provider">
                {booking.provider?.displayName ?? 'Not assigned to a provider'}
              </Field>
              <Field label="Priority">{booking.isEmergency ? 'Emergency' : 'Standard'}</Field>
              <Field label="Charging option">
                {chargeLabel}
                {booking.charging === 'CUSTOMER_BUDGET' && ' (customer-named budget)'}
              </Field>
              <div className="sm:col-span-2">
                <Field label="Customer requirements">
                  {booking.description ? (
                    <span className="whitespace-pre-line">{booking.description}</span>
                  ) : (
                    <span className="text-ink-400">The customer did not add a description.</span>
                  )}
                </Field>
              </div>
            </dl>
          </Panel>

          <Panel
            title="Service location and contact"
            description="Where the work happens, and who the technician should ask for."
          >
            <div className="flex items-start gap-2.5 text-sm text-ink-800">
              <Icon name="location" size={16} className="mt-0.5 shrink-0 text-ink-400" />
              <span>{address}</span>
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-4 border-t border-ink-100 pt-4 sm:grid-cols-2">
              <Field label="Contact name">{booking.contactName}</Field>
              <Field label="Contact phone">
                {telLink(booking.contactPhone) ? (
                  <a
                    href={telLink(booking.contactPhone) ?? '#'}
                    className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline"
                  >
                    <Icon name="phone" size={13} />
                    {booking.contactPhone}
                  </a>
                ) : (
                  booking.contactPhone
                )}
              </Field>
              <Field label="Landmark">
                {booking.landmark ?? <span className="text-ink-400">Not provided</span>}
              </Field>
              <Field label="Area">{booking.area}</Field>
            </dl>
          </Panel>

          <Panel
            title="Booking lifecycle"
            description="Recorded transitions from the append-only status log. Later stages are listed as not yet recorded."
          >
            <div className="rounded-lg border border-ink-200 bg-ink-50/60 px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  Current stage
                </span>
                <StatusBadge label={statusLabel} tone={toneForStatus(booking.status)} dot />
              </div>
              {statusHint && <p className="mt-1.5 text-sm text-ink-700">{statusHint}</p>}
              {lifecycle.nextAction && (
                <p className="mt-1 text-xs text-ink-500">Next: {lifecycle.nextAction}</p>
              )}
            </div>

            {booking.statusEvents.length === 0 ? (
              <div className="mt-4">
                <Notice tone="neutral">
                  No status transition has been recorded for this booking yet. It is still in its
                  creation state, so no other timestamp exists to show.
                </Notice>
              </div>
            ) : (
              <ol className="mt-4">
                {booking.statusEvents.map((event, index) => (
                  <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                    <div className="flex flex-col items-center">
                      <span
                        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success-bg text-success ring-1 ring-inset ring-success/25"
                        aria-hidden
                      >
                        <Icon name="check" size={11} />
                      </span>
                      {index < booking.statusEvents.length - 1 && (
                        <span className="mt-1 w-px flex-1 bg-ink-200" aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0 pb-1">
                      <p className="text-sm font-semibold text-ink-900">
                        {STATUS_LABEL[event.to as keyof typeof STATUS_LABEL] ?? event.to}
                        {event.from && (
                          <span className="ml-1.5 text-xs font-normal text-ink-400">
                            from {STATUS_LABEL[event.from as keyof typeof STATUS_LABEL] ?? event.from}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-ink-500">
                        {formatDateTime(event.createdAt)}
                        {event.actorRole
                          ? ` · ${ROLE_LABEL[event.actorRole as Role] ?? event.actorRole}`
                          : ' · system'}
                      </p>
                      {event.note && <p className="mt-1 text-xs text-ink-600">{event.note}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {lifecycle.stages.some((stage) => stage.state === 'pending') && (
              <div className="mt-4 border-t border-ink-100 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                  Remaining stages (not yet reached)
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {lifecycle.stages
                    .filter((stage) => stage.state === 'pending')
                    .map((stage) => (
                      <li key={stage.status}>
                        <span className="inline-flex items-center rounded-full border border-dashed border-ink-300 px-2.5 py-0.5 text-[11px] font-medium text-ink-400">
                          {stage.label}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Actions" description="Only transitions this booking's state permits.">
            {canConfirm || canAssign ? (
              <p className="text-xs leading-relaxed text-ink-600">
                {canConfirm &&
                  'This booking is awaiting confirmation. Confirming moves it to Confirmed; a technician can be assigned afterwards.'}
                {canAssign &&
                  'This booking is confirmed and has no technician. Assigning one moves it to Technician assigned.'}
              </p>
            ) : (
              <p className="text-xs leading-relaxed text-ink-600">
                {booking.technician
                  ? 'A technician is assigned. No further dispatch action is available from this screen.'
                  : `No administrative action is available while this booking is ${statusLabel.toLowerCase()}.`}
              </p>
            )}
            <p className="mt-3 border-t border-ink-100 pt-3 text-[11px] leading-relaxed text-ink-400">
              Every action is re-validated against the booking state machine on the server and
              written to the audit log. A rejected transition leaves the booking unchanged. The
              available action buttons sit beside the booking title.
            </p>
          </Panel>

          <Panel title="Technician and dispatch">
            {booking.technician ? (
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">
                      {booking.technician.displayName}
                    </p>
                    <p className="truncate text-xs text-ink-500">
                      {booking.technician.headline ?? 'No headline recorded'}
                    </p>
                  </div>
                  <StatusBadge
                    label={booking.technician.isActive ? 'Active' : 'Inactive'}
                    tone={booking.technician.isActive ? 'success' : 'neutral'}
                    dot
                  />
                </div>
                <dl className="mt-3 space-y-3 border-t border-ink-100 pt-3">
                  <Field label="Assignment">Assigned to this booking</Field>
                  <Field label="Availability">
                    {booking.technician.isAvailable ? 'Marked available' : 'Not marked available'}
                  </Field>
                  <Field label="Skills">
                    {booking.technician.skills ?? (
                      <span className="text-ink-400">No skills recorded</span>
                    )}
                  </Field>
                  <Field label="Phone">
                    {booking.technician.phone && telLink(booking.technician.phone) ? (
                      <a
                        href={telLink(booking.technician.phone) ?? '#'}
                        className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline"
                      >
                        <Icon name="phone" size={13} />
                        {booking.technician.phone}
                      </a>
                    ) : (
                      <span className="text-ink-400">Not recorded</span>
                    )}
                  </Field>
                </dl>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-400">
                  <Icon name="user" size={16} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-800">No technician assigned</p>
                  <p className="text-xs text-ink-500">
                    {booking.status === 'REQUESTED'
                      ? 'Assignment opens once the booking is confirmed.'
                      : 'This booking is awaiting a technician.'}
                  </p>
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Pricing">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
              {price.headline}
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-ink-900">
              {price.kind === 'published'
                ? formatINR(price.quotedPaise)
                : price.kind === 'budget'
                  ? `${formatINR(price.budgetMinPaise)} – ${formatINR(price.budgetMaxPaise)}`
                  : 'Not published'}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-500">{price.note}</p>

            <div className="mt-4 border-t border-ink-100 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                Final invoice
              </p>
              {booking.invoice ? (
                <dl className="mt-2 space-y-3">
                  <Field label="Invoice number">
                    <Link
                      href={`/admin/invoices/${booking.invoice.id}`}
                      className="font-mono text-brand-700 hover:underline"
                    >
                      {booking.invoice.number}
                    </Link>
                  </Field>
                  <Field label="Invoice status">
                    <StatusBadge
                      label={invoiceStatusLabel(booking.invoice.status)}
                      tone={toneForStatus(booking.invoice.status)}
                      dot
                    />
                  </Field>
                  <Field label="Invoice total">
                    {formatINR(booking.invoice.totalPaise)} {booking.invoice.currency}
                  </Field>
                  {booking.invoice.issuedAt && (
                    <Field label="Issued">{formatDate(booking.invoice.issuedAt)}</Field>
                  )}
                </dl>
              ) : invoiceEligibility.eligible ? (
                <p className="mt-1.5 text-xs text-ink-500">
                  The work is complete and a price is recorded, so this booking can be invoiced.
                  Use <span className="font-semibold text-ink-700">Issue invoice</span> beside the
                  booking title.
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-ink-500">{invoiceEligibility.reason}</p>
              )}
              {booking.invoice && (
                <a
                  href={`/api/admin/invoices/${booking.invoice.id}/pdf`}
                  download
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 underline underline-offset-2"
                >
                  Download invoice PDF
                </a>
              )}
            </div>
          </Panel>

          <Panel title="Customer">
            <dl className="space-y-3">
              <Field label="Name">{booking.customer.name}</Field>
              <Field label="Dispatch contact">
                {booking.contactName}
                {telLink(booking.contactPhone) ? (
                  <a
                    href={telLink(booking.contactPhone) ?? '#'}
                    className="ml-1.5 inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                  >
                    <Icon name="phone" size={13} />
                    {booking.contactPhone}
                  </a>
                ) : null}
              </Field>
              <Field label="Customer since">{formatDate(booking.customer.createdAt)}</Field>
              <Field label="Account reference">
                <span className="font-mono text-[11px] text-ink-500">{booking.customer.id}</span>
              </Field>
            </dl>
            <p className="mt-3 border-t border-ink-100 pt-3 text-[11px] leading-relaxed text-ink-400">
              Only what dispatch needs is shown: the contact the customer supplied for this visit.
              The account&apos;s own email and phone are deliberately not read by this screen.
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

