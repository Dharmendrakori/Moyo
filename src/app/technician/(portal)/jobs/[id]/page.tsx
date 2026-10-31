import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge, toneForStatus } from '@/components/ui/StatusBadge';
import { getTechnicianJob } from '@/lib/technician-access';
import { requireTechnicianPage } from '@/lib/technician-page-guard';
import { STATUS_HINT, STATUS_LABEL } from '@/lib/booking-state';
import { MODE_LABEL, type BookingMode, type BookingStatus } from '@/lib/domain';
import { formatDateTime, telLink, whatsappLink } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Job detail',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * JOB DETAIL
 *
 * `getTechnicianJob(technicianId, id)` puts the session's technician id in the
 * WHERE clause, so a job assigned to a colleague is indistinguishable from one
 * that does not exist - both render the standard not-found page. Guessing an id in
 * the URL therefore reveals nothing.
 *
 * WHAT IS DELIBERATELY ABSENT: invoice amounts, payment records, refunds, the
 * customer's account email/phone, and any administrative note. Only the dispatch
 * contact the customer supplied for this visit is shown.
 */
export default async function TechnicianJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { technician } = await requireTechnicianPage();
  const { id } = await params;

  const job = await getTechnicianJob(technician.id, id);
  if (!job) notFound();

  const address = [job.addressLine1, job.addressLine2, job.area, job.city, job.state, job.pincode]
    .filter(Boolean)
    .join(', ');

  const call = telLink(job.contactPhone);
  const whatsapp = whatsappLink(
    job.contactPhone,
    'Hello, regarding my Seric Tech Solutions booking.',
  );
  const status = job.status as BookingStatus;

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="text-xs text-ink-500">
        <Link href="/technician/jobs" className="hover:text-brand-700 hover:underline">
          My jobs
        </Link>
        <span className="mx-1.5">/</span>
        <span className="font-mono font-medium text-ink-700">{job.reference}</span>
      </nav>

      <header className="rounded-card border border-ink-200 bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight text-ink-900">{job.service.name}</h1>
            <p className="mt-0.5 font-mono text-[11px] text-ink-400">{job.reference}</p>
          </div>
          <StatusBadge
            label={STATUS_LABEL[status] ?? job.status}
            tone={toneForStatus(job.status)}
            dot
          />
        </div>
        <p className="mt-2 text-sm text-ink-600">{STATUS_HINT[status] ?? ''}</p>
        {job.isEmergency && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-danger-bg px-2.5 py-1 text-xs font-semibold text-danger">
            <Icon name="alert-triangle" size={13} /> Emergency booking
          </p>
        )}
      </header>

      <section className="rounded-card border border-ink-200 bg-white p-4 shadow-card">
        <h2 className="text-sm font-semibold text-ink-900">Visit</h2>
        <dl className="mt-2 space-y-2 text-sm">
          <Row label="Scheduled">
            {job.scheduledFor ? formatDateTime(job.scheduledFor) : 'Not scheduled'}
          </Row>
          <Row label="Mode">{MODE_LABEL[job.mode as BookingMode] ?? job.mode}</Row>
          <Row label="Address">{address || 'No address recorded'}</Row>
          {job.landmark && <Row label="Landmark">{job.landmark}</Row>}
        </dl>

        {job.description && (
          <div className="mt-3 rounded-lg bg-ink-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
              What the customer reported
            </p>
            <p className="mt-1 text-sm leading-relaxed text-ink-700">{job.description}</p>
          </div>
        )}
      </section>

      <section className="rounded-card border border-ink-200 bg-white p-4 shadow-card">
        <h2 className="text-sm font-semibold text-ink-900">Dispatch contact</h2>
        <p className="mt-2 text-sm text-ink-700">{job.contactName}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-3 text-sm text-ink-600">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="phone" size={14} className="text-ink-400" />
            {job.contactPhone}
          </span>
          {call && (
            <a href={call} className="font-semibold text-brand-700 hover:underline">
              Call
            </a>
          )}
          {whatsapp && (
            <a href={whatsapp} className="font-semibold text-brand-700 hover:underline">
              WhatsApp
            </a>
          )}
        </p>
        <p className="mt-3 border-t border-ink-100 pt-3 text-[11px] leading-relaxed text-ink-400">
          Only the contact supplied for this visit is shown. The customer&apos;s account details and
          any payment information are not available in the portal.
        </p>
      </section>

      <JobHistory events={job.statusEvents} />
    </div>
  );

/** The append-only status log, rendered as what actually happened. */
function JobHistory({
  events,
}: {
  events: Array<{
    id: string;
    from: string | null;
    to: string;
    actorRole: string | null;
    note: string | null;
    createdAt: Date;
  }>;
}) {
  return (
    <section className="rounded-card border border-ink-200 bg-white p-4 shadow-card">
      <h2 className="text-sm font-semibold text-ink-900">History</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-ink-500">No status history recorded yet.</p>
      ) : (
        <ol className="mt-2 space-y-2.5">
          {events.map((event) => (
            <li key={event.id} className="flex gap-2.5">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink-800">
                  {event.from
                    ? `${STATUS_LABEL[event.from as BookingStatus] ?? event.from} → ${
                        STATUS_LABEL[event.to as BookingStatus] ?? event.to
                      }`
                    : (STATUS_LABEL[event.to as BookingStatus] ?? event.to)}
                </p>
                <p className="text-[11px] text-ink-400">
                  {formatDateTime(event.createdAt)}
                  {event.actorRole ? ` · by ${event.actorRole.toLowerCase()}` : ''}
                  {event.note ? ` · ${event.note}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 border-t border-ink-100 pt-3 text-[11px] leading-relaxed text-ink-400">
        Status updates are recorded by dispatch in this release. Technician-side status controls are
        not enabled yet, so no action on this page can move the booking forward.
      </p>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-100 pb-1.5 last:border-0">
      <dt className="text-xs font-medium uppercase tracking-wider text-ink-400">{label}</dt>
      <dd className="min-w-0 max-w-[70%] text-right text-ink-800">{children}</dd>
    </div>
  );
}

}
