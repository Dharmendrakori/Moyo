import Link from 'next/link';
import { requireAdminPage } from '@/lib/admin-page-guard';
import { StatCard, StatusBadge, toneForStatus } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/States';
import { Panel, PageHeader } from '@/components/admin/DataTable';
import { getDashboardMetrics } from '@/lib/admin-metrics';
import { STATUS_LABEL } from '@/lib/booking-state';
import { isBookingStatus } from '@/lib/domain';
import { formatINRCompact } from '@/lib/format';
import { Icon, type IconName } from '@/components/ui/Icon';

/**
 * ADMIN DASHBOARD
 *
 * Every metric is a live database aggregate (see lib/admin-metrics.ts). Nothing
 * here is a placeholder or a sample number - if the database is empty the tiles
 * read zero, which is the honest state.
 *
 * LINKS ONLY GO TO SCREENS THAT EXIST. This page previously linked to modules
 * such as Dispatch, Providers, Orders and Invoices that have not been built. A
 * dashboard tile pointing at a 404 is a broken promise, so figures whose
 * screens are still planned are shown as plain, non-navigable values instead.
 * Shortcuts go only to real routes, and only to the filtered views their query
 * schemas actually accept.
 *
 * The page also re-checks the admin role itself, so it stays safe even if the
 * layout guard were removed.
 */
export const dynamic = 'force-dynamic';


/**
 * Static month labels for the bookings trend chart, in calendar order.
 *
 * Declared at the top of the module — before every component and helper —
 * so it is initialized before any invocation of `formatChartDay()` can occur,
 * regardless of bundler chunking or hot-reload evaluation order. A `const` in
 * the temporal dead zone throws `ReferenceError` at runtime (which
 * typecheck/lint cannot catch), so placement here is load-bearing.
 */
const CHART_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export default async function AdminDashboardPage() {
  await requireAdminPage();

  const metrics = await getDashboardMetrics();
  const maxTrend = Math.max(1, ...metrics.bookingTrend.map((d) => d.count));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations dashboard"
        description="Live figures from the database. These update as bookings, catalogue changes and payments are recorded — nothing here is estimated or cached."
        actions={
          <Link
            href="/admin/bookings"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-700"
          >
            <Icon name="clipboard" size={15} />
            Open dispatch queue
          </Link>
        }
      />

      {/*
        Attention strip: only real counts that need an operator's attention, and
        only linked to a screen that can actually resolve them.
      */}
      {(metrics.pendingBookings > 0 || metrics.unpublishedPrices > 0) && (
        <section
          aria-label="Needs attention"
          className="rounded-card border border-warning/25 bg-warning-bg px-5 py-4 shadow-card"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <span className="h-2 w-2 rounded-full bg-warning" aria-hidden />
            Needs attention
          </h2>
          <ul className="mt-2 space-y-1.5 text-sm text-ink-700">
            {metrics.pendingBookings > 0 && (
              <li className="flex flex-wrap items-center gap-x-2">
                <span className="font-semibold tabular-nums text-ink-900">
                  {metrics.pendingBookings}
                </span>
                <span>booking{metrics.pendingBookings === 1 ? '' : 's'} awaiting confirmation.</span>
                <Link
                  href="/admin/bookings?status=REQUESTED"
                  className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                >
                  Review the confirmation queue
                </Link>
              </li>
            )}
            {metrics.unpublishedPrices > 0 && (
              <li className="flex flex-wrap items-center gap-x-2">
                <span className="font-semibold tabular-nums text-ink-900">
                  {metrics.unpublishedPrices}
                </span>
                <span>
                  charging option{metrics.unpublishedPrices === 1 ? '' : 's'} without a published
                  price.
                </span>
                <Link
                  href="/admin/pricing?state=UNPUBLISHED"
                  className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                >
                  Publish or confirm pricing
                </Link>
              </li>
            )}
          </ul>
        </section>
      )}

      <section aria-labelledby="operations-heading">
        <h2
          id="operations-heading"
          className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500"
        >
          Dispatch
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Active bookings"
            value={metrics.activeBookings}
            hint={`${metrics.newBookingsToday} placed today`}
            icon="clipboard"
            tone="brand"
            href="/admin/bookings"
          />
          <StatCard
            label="Awaiting confirmation"
            value={metrics.pendingBookings}
            hint="Bookings still in Requested"
            icon="clock"
            tone={metrics.pendingBookings > 0 ? 'warning' : 'neutral'}
            href="/admin/bookings?status=REQUESTED"
          />
          <StatCard
            label="Completed"
            value={metrics.completedBookings}
            hint="Work marked complete"
            icon="check-circle"
            tone="success"
          />
          <StatCard
            label="Active technicians"
            value={metrics.activeTechnicians}
            hint="Enabled for dispatch"
            icon="user"
          />
        </div>
      </section>

      <section aria-labelledby="catalog-heading">
        <h2
          id="catalog-heading"
          className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500"
        >
          Catalogue and commerce
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Services"
            value={metrics.totalServices}
            hint={`${metrics.activeServices} active and bookable`}
            icon="bolt"
            href="/admin/services"
          />
          <StatCard
            label="Categories"
            value={metrics.categories}
            hint={`${metrics.activeCategories} active in the catalogue`}
            icon="grid"
            href="/admin/categories"
          />
          <StatCard
            label="Published prices"
            value={metrics.publishedPrices}
            hint={
              metrics.unpublishedPrices === 0
                ? 'Every offered option is priced'
                : `${metrics.unpublishedPrices} options still unpriced`
            }
            icon="receipt"
            href="/admin/pricing"
          />
          <StatCard
            label="Revenue (settled)"
            value={formatINRCompact(metrics.revenuePaise)}
            hint="Paid invoices only"
            icon="wallet"
            tone="success"
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <BookingTrendChart data={metrics.bookingTrend} max={maxTrend} />
        </div>
        <div className="lg:col-span-2">
          <StatusBreakdown rows={metrics.statusBreakdown} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel
          title="Shortcuts"
          description="Jump straight into the filtered view you need."
          className="lg:col-span-2"
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            <Shortcut
              href="/admin/bookings?status=REQUESTED"
              icon="clock"
              label="Confirmation queue"
              hint={`${metrics.pendingBookings} waiting`}
            />
            <Shortcut
              href="/admin/bookings"
              icon="clipboard"
              label="All bookings"
              hint={`${metrics.activeBookings} active`}
            />
            <Shortcut
              href="/admin/services?status=INACTIVE"
              icon="bolt"
              label="Deactivated services"
              hint="Hidden from customers"
            />
            <Shortcut
              href="/admin/pricing?state=UNPUBLISHED"
              icon="wallet"
              label="Unpriced options"
              hint={`${metrics.unpublishedPrices} to price`}
            />
            <Shortcut
              href="/admin/charging-options"
              icon="receipt"
              label="Charging options"
              hint="Visit, fixed, budget"
            />
            <Shortcut
              href="/admin/categories"
              icon="grid"
              label="Categories"
              hint={`${metrics.activeCategories} live`}
            />
          </ul>
        </Panel>

        <Panel title="Platform" description="Figures whose screens are still planned.">
          <dl className="space-y-2.5 text-sm">
            <PlatformRow label="Total customers" value={metrics.totalUsers} />
            <PlatformRow label="Invoices unpaid" value={metrics.pendingPayments} />
            <PlatformRow label="Reviews awaiting moderation" value={metrics.pendingReviews} />
            <PlatformRow label="Open support threads" value={metrics.openSupportRequests} />
            <PlatformRow label="Material orders" value={metrics.materialOrders} />
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
            These counts are live, but invoicing, review moderation and support handling are not yet
            built into the console, so they are shown as plain figures rather than links.
          </p>
        </Panel>
      </div>
    </div>
  );
}

/** A real link into an existing admin screen, with its live count. */
function Shortcut({
  href,
  icon,
  label,
  hint,
}: {
  href: string;
  icon: IconName;
  label: string;
  hint: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-lg border border-ink-200 px-3 py-2.5 transition hover:border-brand-300 hover:bg-brand-50/50"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-600">
          <Icon name={icon} size={15} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-ink-900">{label}</span>
          <span className="block truncate text-[11px] text-ink-500">{hint}</span>
        </span>
        <Icon name="chevron-right" size={14} className="ml-auto shrink-0 text-ink-300" />
      </Link>
    </li>
  );
}

function PlatformRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-600">{label}</dt>
      <dd className="font-semibold tabular-nums text-ink-900">{value}</dd>
    </div>
  );
}

/*
 * Dependency-free bar chart. Rendered as plain elements rather than a charting
 * library, which keeps the admin bundle small and avoids a third-party script
 * (a supply-chain and CSP liability). An all-zero week renders an honest empty
 * state instead of a flat, meaningless chart.
 */


/**
 * Deterministic `DD Mon` label parsed from the `YYYY-MM-DD` key.
 *
 * Deliberately NOT `toLocaleDateString`: that renders from the runtime's ICU
 * and timezone, so the server and the browser can emit different strings for
 * the same date (a UTC-midnight parsed date shifts a calendar day behind UTC).
 * A mismatch inside this SSR tree forces React to discard hydration and
 * regenerate the whole admin tree on the client — the exact class of first-load
 * failure that leaves client interactivity (including the sidebar toggle)
 * suspect. Calendar-day parsing keeps the label identical everywhere.
 */
function formatChartDay(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return isoDay;
  return `${String(d).padStart(2, '0')} ${CHART_MONTHS[m - 1]}`;
}

function BookingTrendChart({
  data,
  max,
}: {
  data: Array<{ date: string; count: number }>;
  max: number;
}) {
  if (data.every((d) => d.count === 0)) {
    return (
      <Panel title="Bookings, last 7 days">
        <EmptyState
          icon="chart"
          title="No bookings in the last 7 days"
          description="The chart fills in as bookings are created."
          className="py-8"
        />
      </Panel>
    );
  }

  return (
    <Panel title="Bookings, last 7 days">
      <ul className="flex h-40 items-end gap-2">
        {data.map((day) => {
          const heightPct = Math.round((day.count / max) * 100);
          return (
            <li key={day.date} className="flex flex-1 flex-col items-center gap-2">
              <span className="text-xs font-semibold tabular-nums text-ink-700">{day.count}</span>
              <div
                className="w-full rounded-t bg-brand-500 transition-[height] duration-300 motion-reduce:transition-none"
                style={{ height: `${Math.max(heightPct, 3)}%` }}
                role="img"
                aria-label={`${day.count} bookings on ${day.date}`}
              />
              <span className="text-[10px] text-ink-400">{formatChartDay(day.date)}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Bookings grouped by status. Empty until bookings exist. */
function StatusBreakdown({ rows }: { rows: Array<{ status: string; count: number }> }) {
  return (
    <Panel
      title="Bookings by status"
      description="Every booking in the database, grouped by its current state."
    >
      {rows.length === 0 ? (
        <EmptyState
          icon="clipboard"
          title="No bookings yet"
          description="The breakdown appears once bookings exist."
          className="py-8"
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.status} className="flex items-center justify-between gap-3">
              <StatusBadge
                label={isBookingStatus(row.status) ? STATUS_LABEL[row.status] : row.status}
                tone={toneForStatus(row.status)}
                dot
              />
              <span className="text-sm font-semibold tabular-nums text-ink-900">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
