import Link from 'next/link';
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
 */
export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const metrics = await getDashboardMetrics();
  const maxTrend = Math.max(1, ...metrics.bookingTrend.map((d) => d.count));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-ink-900">Operations dashboard</h1>
        <p className="mt-1 text-sm text-ink-500">
          Live figures from the database. These update as bookings and payments are recorded.
        </p>
      </header>

      <section aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="sr-only">
          Key metrics
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Active bookings"
            value={metrics.activeBookings}
            hint={`${metrics.newBookingsToday} placed today`}
            icon="clipboard"
            tone="brand"
            href="/admin/bookings"
          />
          <StatCard
            label="Revenue (settled)"
            value={formatINRCompact(metrics.revenuePaise)}
            hint={`${metrics.pendingPayments} invoices awaiting payment`}
            icon="wallet"
            tone="success"
            href="/admin/invoices"
          />
          <StatCard
            label="Active providers"
            value={metrics.activeProviders}
            hint="Providers currently accepting work"
            icon="office"
            tone="info"
            href="/admin/providers"
          />
          <StatCard
            label="Active technicians"
            value={metrics.activeTechnicians}
            hint="Technicians enabled for dispatch"
            icon="user"
            tone="info"
            href="/admin/technicians"
          />
        </div>
      </section>

      <section aria-labelledby="secondary-heading">
        <h2 id="secondary-heading" className="sr-only">
          Secondary metrics
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total customers"
            value={metrics.totalUsers}
            hint={`${metrics.activeCustomers} active`}
            icon="people"
            href="/admin/users"
          />
          <StatCard
            label="Completed bookings"
            value={metrics.completedBookings}
            hint="Work marked complete"
            icon="check-circle"
            tone="success"
          />
          <StatCard
            label="Material orders"
            value={metrics.materialOrders}
            hint="Category 20 orders"
            icon="package"
            href="/admin/orders"
          />
          <StatCard
            label="Open support requests"
            value={metrics.openSupportRequests}
            hint={`${metrics.pendingReviews} reviews awaiting approval`}
            icon="shield"
            tone={metrics.openSupportRequests > 0 ? 'warning' : 'neutral'}
            href="/admin/support"
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <BookingTrendChart data={metrics.bookingTrend} max={maxTrend} />
        <StatusBreakdown rows={metrics.statusBreakdown} />
      </div>

      {metrics.pendingPayments > 0 && (
        <section className="rounded-card border border-warning/30 bg-warning-bg p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <span className="h-2 w-2 rounded-full bg-warning" aria-hidden />
            Requires attention
          </h2>
          <p className="mt-2 text-sm text-ink-600">
            {metrics.pendingPayments} invoice{metrics.pendingPayments === 1 ? '' : 's'} issued but
            not yet settled. Payment status is confirmed only by the payment provider.
          </p>
          <Link
            href="/admin/invoices"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-warning hover:underline"
          >
            Review invoices
          </Link>
        </section>
      )}
    </div>
  );
}

/**
 * Dependency-free bar chart. Rendered as plain elements rather than a charting
 * library, which keeps the admin bundle small and avoids a third-party script
 * (a supply-chain and CSP liability).
 */
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
              <span className="text-[10px] text-ink-400">
                {new Date(day.date).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                })}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

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