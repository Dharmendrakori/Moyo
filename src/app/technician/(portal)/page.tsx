import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge, toneForStatus } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/States';
import { listTechnicianJobs, summariseTechnicianJobs } from '@/lib/technician-access';
import { requireTechnicianPage } from '@/lib/technician-page-guard';
import { STATUS_LABEL } from '@/lib/booking-state';
import { formatDateTime } from '@/lib/format';
import type { BookingStatus } from '@/lib/domain';

export const metadata: Metadata = {
  title: 'Technician overview',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * TECHNICIAN OVERVIEW
 *
 * Counts and the most recent jobs, all read with `technicianId` in the WHERE
 * clause. Nothing here is a company-wide figure: a technician sees only their own
 * work, and no customer account details at all.
 */
export default async function TechnicianHomePage() {
  const { technician } = await requireTechnicianPage();

  const [summary, recent] = await Promise.all([
    summariseTechnicianJobs(technician.id),
    listTechnicianJobs(technician.id, { page: 1 }),
  ]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-bold tracking-tight text-ink-900">
          Hello, {technician.displayName.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Work assigned to you. Dispatch sets the schedule; your status updates come from the
          dispatch team until technician-side status controls are released.
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Assigned" value={summary.assigned} />
        <Stat label="On the way" value={summary.onTheWay} />
        <Stat label="At site / working" value={summary.inProgress} />
        <Stat label="Scheduled today" value={summary.upcomingToday} />
      </dl>

      <section className="overflow-hidden rounded-card border border-ink-200 bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-900">Most recent jobs</h2>
          <Link
            href="/technician/jobs"
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
          >
            All jobs <Icon name="chevron-right" size={13} />
          </Link>
        </div>

        {recent.items.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title="No jobs assigned yet"
            description="When dispatch assigns work to you it appears here with the service address and contact."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {recent.items.slice(0, 5).map((job) => (
              <li key={job.id}>
                <Link
                  href={`/technician/jobs/${job.id}`}
                  className="flex flex-col gap-2 px-4 py-3 transition hover:bg-ink-50/70 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">
                      {job.service.name}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-400">{job.reference}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {[job.area, job.city].filter(Boolean).join(', ') || 'Address on the job'}
                      {job.scheduledFor ? ` · ${formatDateTime(job.scheduledFor)}` : ''}
                    </p>
                  </div>
                  <StatusBadge
                    label={STATUS_LABEL[job.status as BookingStatus] ?? job.status}
                    tone={toneForStatus(job.status)}
                    dot
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-ink-200 bg-white p-3.5 shadow-card">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">{label}</dt>
      <dd className="mt-1 text-xl font-bold tabular-nums text-ink-900">{value}</dd>
    </div>
  );
}
