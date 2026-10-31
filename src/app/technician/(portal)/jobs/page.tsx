import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusBadge, toneForStatus } from '@/components/ui/StatusBadge';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { listTechnicianJobs } from '@/lib/technician-access';
import { requireTechnicianPage } from '@/lib/technician-page-guard';
import { STATUS_LABEL } from '@/lib/booking-state';
import { technicianJobQuerySchema, normaliseSearchParams } from '@/lib/validation';
import { formatDateTime } from '@/lib/format';
import type { BookingStatus } from '@/lib/domain';

export const metadata: Metadata = {
  title: 'My jobs',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** The statuses that matter to a technician. */
const FILTERS: Array<{ value: string; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'TECHNICIAN_ASSIGNED', label: 'Assigned' },
  { value: 'TECHNICIAN_ON_THE_WAY', label: 'On the way' },
  { value: 'SERVICE_IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
];

/**
 * MY JOBS
 *
 * OWNERSHIP IS IN THE QUERY: `listTechnicianJobs` filters by the technician id
 * taken from the session, so a booking assigned to somebody else cannot appear
 * here even if a URL is guessed. There is no id parameter on this page at all.
 *
 * Filters and paging are real links, so the view stays a URL that can be
 * bookmarked, and no job data is duplicated into the browser.
 */
export default async function TechnicianJobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { technician } = await requireTechnicianPage();

  const raw = normaliseSearchParams(await searchParams);
  const parsed = technicianJobQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : technicianJobQuerySchema.parse({});

  let result: Awaited<ReturnType<typeof listTechnicianJobs>>;
  try {
    result = await listTechnicianJobs(technician.id, {
      status: query.status === 'ALL' ? undefined : query.status,
      page: query.page,
    });
  } catch {
    return <ErrorState description="Your jobs could not be loaded. Please try again." />;
  }

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.status !== 'ALL') params.set('status', query.status);
    params.set('page', String(page));
    return `/technician/jobs?${params.toString()}`;
  };

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-bold tracking-tight text-ink-900">My jobs</h1>
        <p className="mt-1 text-sm text-ink-500">
          {result.total === 0
            ? 'Nothing assigned to you yet.'
            : `${result.total} job${result.total === 1 ? '' : 's'} assigned to you.`}
        </p>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by status">
        {FILTERS.map((filter) => {
          const active = query.status === filter.value;
          const href =
            filter.value === 'ALL' ? '/technician/jobs' : `/technician/jobs?status=${filter.value}`;
          return (
            <Link
              key={filter.value}
              href={href}
              aria-current={active ? 'true' : undefined}
              className={
                active
                  ? 'whitespace-nowrap rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white'
                  : 'whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50'
              }
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      {result.items.length === 0 ? (
        <div className="rounded-card border border-ink-200 bg-white shadow-card">
          <EmptyState
            icon="clipboard"
            title={query.status === 'ALL' ? 'No jobs assigned yet' : 'No jobs with this status'}
            description={
              query.status === 'ALL'
                ? 'Dispatch assigns work to you. When a booking is assigned it appears here.'
                : 'Try a different status filter.'
            }
            action={
              <Link
                href="/technician/jobs"
                className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white shadow-card transition hover:bg-brand-700"
              >
                Show all jobs
              </Link>
            }
          />
        </div>
      ) : (
        <ul className="space-y-2">
          {result.items.map((job) => (
            <li key={job.id}>
              <Link
                href={`/technician/jobs/${job.id}`}
                className="block rounded-card border border-ink-200 bg-white p-4 shadow-card transition hover:border-brand-300 hover:shadow-raised"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">{job.service.name}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-400">{job.reference}</p>
                  </div>
                  <StatusBadge
                    label={STATUS_LABEL[job.status as BookingStatus] ?? job.status}
                    tone={toneForStatus(job.status)}
                    dot
                  />
                </div>
                <p className="mt-2 text-xs text-ink-500">
                  {[job.area, job.city].filter(Boolean).join(', ') || 'Address on the job'}
                </p>
                <p className="mt-0.5 text-xs text-ink-400">
                  {job.scheduledFor
                    ? `Scheduled ${formatDateTime(job.scheduledFor)}`
                    : 'No scheduled time recorded'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {result.total > result.pageSize && (
        <nav className="flex items-center justify-between text-xs" aria-label="Pagination">
          {result.page > 1 ? (
            <Link href={buildHref(result.page - 1)} className="font-semibold text-brand-700">
              Previous
            </Link>
          ) : (
            <span className="text-ink-300">Previous</span>
          )}
          <span className="text-ink-500">
            Page {result.page} of {totalPages}
          </span>
          {result.page < totalPages ? (
            <Link href={buildHref(result.page + 1)} className="font-semibold text-brand-700">
              Next
            </Link>
          ) : (
            <span className="text-ink-300">Next</span>
          )}
        </nav>
      )}
    </div>
  );
}
