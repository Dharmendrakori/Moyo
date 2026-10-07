import { requireAdminPage } from '@/lib/admin-page-guard';
import { StatCard, StatusBadge, toneForStatus } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/States';
import { getDashboardMetrics } from '@/lib/admin-metrics';
import { STATUS_LABEL } from '@/lib/booking-state';
import { isBookingStatus } from '@/lib/domain';
import { formatINRCompact } from '@/lib/format';

/**
 * ADMIN DASHBOARD
 *
 * Every metric is a live database aggregate (see lib/admin-metrics.ts). Nothing
 * here is a placeholder or a sample number - if the database is empty the tiles
 * read zero, which is the honest state.
 *
 * TILES LINK ONLY TO SCREENS THAT EXIST. This page previously linked to modules
 * such as Dispatch, Providers, Orders and Invoices that have not been built. A
 * dashboard tile pointing at a 404 is a broken promise, so figures whose
 * screens are still planned are shown as plain, non-navigable values instead.
 *
 * The page also re-checks the admin role itself, so it stays safe even if the
 * layout guard were removed.
 */
export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  await requireAdminPage();

  const metrics = await getDashboardMetrics();
  const maxTrend = Math.max(1, ...metrics.bookingTrend.map((d) => d.count));
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-ink-900">Operations dashboard</h1>
        <p className="mt-1 text-sm text-ink-500">
          Live figures from the database. These update as bookings, catalogue changes and payments
          are recorded.
        </p>
      </header>

      <section aria-labelledby="catalog-heading">
        <h2 id="catalog-heading" className="sr-only">
          Catalogue
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            label="Unpublished prices"
            value={metrics.unpublishedPrices}
            hint="Customers see “on request”"
            icon="wallet"
            tone={metrics.unpublishedPrices === 0 ? 'success' : 'warning'}
            href="/admin/charging-options"
          />
        </div>
      </section>

      <section aria-labelledby="operations-heading">
        <h2 id="operations-heading" className="sr-only">
          Operations
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Active bookings"
            value={metrics.activeBookings}
            hint={`${metrics.newBookingsToday} placed today`}
            icon="clipboard"
            tone="brand"
          />
          <StatCard
            label="Awaiting confirmation"
            value={metrics.pendingBookings}
            hint="Bookings still in REQUESTED"
            icon="clock"
            tone={metrics.pendingBookings > 0 ? 'warning' : 'neutral'}
          />
          <StatCard
            label="Completed bookings"
            value={metrics.completedBookings}
            hint="Work marked complete"
            icon="check-circle"
            tone="success"
          />
          <StatCard
            label="Total customers"
            value={metrics.totalUsers}
            hint={`${metrics.activeCustomers} active accounts`}
            icon="people"
          />
        </div>
      </section>

      <section aria-labelledby="commerce-heading">
        <h2 id="commerce-heading" className="sr-only">
          Commerce and platform
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Revenue (settled)"
            value={formatINRCompact(metrics.revenuePaise)}
            hint="Paid invoices only"
            icon="wallet"
            tone="success"
          />
          <StatCard
            label="Invoices unpaid"
            value={metrics.pendingPayments}
            hint="Issued or overdue"
            icon="receipt"
            tone={metrics.pendingPayments > 0 ? 'warning' : 'neutral'}
          />
          <StatCard
            label="Active technicians"
            value={metrics.activeTechnicians}
            hint="Enabled for dispatch"
            icon="user"
          />
          <StatCard
            label="Material orders"
            value={metrics.materialOrders}
            hint="Category 20 orders"
            icon="package"
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <BookingTrendChart data={metrics.bookingTrend} max={maxTrend} />
        <StatusBreakdown rows={metrics.statusBreakdown} />
      </div>

      {metrics.pendingReviews > 0 && (
        <section className="rounded-card border border-warning/30 bg-warning-bg p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <span className="h-2 w-2 rounded-full bg-warning" aria-hidden />
            Requires attention
          </h2>
          <p className="mt-2 text-sm text-ink-600">
            {metrics.pendingReviews} review{metrics.pendingReviews === 1 ? '' : 's'} awaiting
            moderation, and {metrics.openSupportRequests} open support thread
            {metrics.openSupportRequests === 1 ? '' : 's'}. Review moderation and support handling
            are not yet built into the console.
          </p>
        </section>
      )}
    </div>
  );

/**
 * Dependency-free bar chart. Rendered as plain elements rather than a charting
 * library, which keeps the admin bundle small and avoids a third-party script
 * (a supply-chain and CSP liability). An all-zero week renders an honest empty
 * state instead of a flat, meaningless chart.
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
      <section className="rounded-card border border-ink-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-ink-900">Bookings, last 7 days</h2>
        <EmptyState
          icon="chart"
          title="No bookings in the last 7 days"
          description="The chart fills in as bookings are created."
          className="py-8"
        />
      </section>
    );
  }

  return (
    <section className="rounded-card border border-ink-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-ink-900">Bookings, last 7 days</h2>
      <ul className="mt-5 flex h-40 items-end gap-2">
        {data.map((day) => {
          const heightPct = Math.round((day.count / max) * 100);
          return (
            <li key={day.date} className="flex flex-1 flex-col items-center gap-2">
              <span className="text-xs font-semibold tabular-nums text-ink-700">{day.count}</span>
              <div
                className="w-full rounded-t bg-brand-500"
                style={{ height: `${Math.max(heightPct, 3)}%` }}
                role="img"
                aria-label={`${day.count} bookings on ${day.date}`}
              />
              <span className="text-[10px] text-ink-400">{formatChartDay(day.date)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Bookings grouped by status. Empty until bookings exist. */
function StatusBreakdown({ rows }: { rows: Array<{ status: string; count: number }> }) {
  return (
    <section className="rounded-card border border-ink-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-ink-900">Bookings by status</h2>
      {rows.length === 0 ? (
        <EmptyState
          icon="clipboard"
          title="No bookings yet"
          description="The breakdown appears once bookings exist."
          className="py-8"
        />
      ) : (
        <ul className="mt-4 space-y-2">
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
    </section>
  );
}

}