import 'server-only';
import { prisma } from './prisma';

/**
 * ADMIN DASHBOARD METRICS
 *
 * Every figure here is a real aggregate computed from the database. Nothing is
 * hard-coded, seeded with a sample number, or estimated.
 *
 * Money is summed in paise (integers) to avoid floating-point drift.
 */

export type DashboardMetrics = {
  totalUsers: number;
  activeCustomers: number;
  activeProviders: number;
  activeTechnicians: number;
  newBookingsToday: number;
  activeBookings: number;
  /** Bookings still awaiting provider confirmation. */
  pendingBookings: number;
  completedBookings: number;
  pendingPayments: number;
  revenuePaise: number;
  materialOrders: number;
  openSupportRequests: number;
  pendingReviews: number;
  /** The official categories actually present in the database. */
  categories: number;
  activeCategories: number;
  totalServices: number;
  activeServices: number;
  /** Enabled charging options that carry a published price. */
  publishedPrices: number;
  /** Enabled charging options with no published price yet. */
  unpublishedPrices: number;
  /** Bookings, last 7 days, oldest first. */
  bookingTrend: Array<{ date: string; count: number }>;
  /** Bookings grouped by status, for the operations breakdown. */
  statusBreakdown: Array<{ status: string; count: number }>;
};

const ACTIVE_BOOKING_STATUSES = [
  'REQUESTED',
  'CONFIRMED',
  'TECHNICIAN_ASSIGNED',
  'TECHNICIAN_ON_THE_WAY',
  'ARRIVED',
  'SERVICE_IN_PROGRESS',
];

/** Start of today (local server time), for the "new today" metric. */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const today = startOfToday();
  const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    activeCustomers,
    activeProviders,
    activeTechnicians,
    newBookingsToday,
    activeBookings,
    pendingBookings,
    completedBookings,
    pendingPayments,
    revenue,
    materialOrders,
    openSupportRequests,
    pendingReviews,
    categories,
    activeCategories,
    totalServices,
    activeServices,
    publishedPrices,
    unpublishedPrices,
    trendRows,
    statusRows,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.user.count({ where: { role: 'CUSTOMER', isActive: true } }),
    prisma.provider.count({ where: { isActive: true } }),
    prisma.technician.count({ where: { isActive: true } }),
    prisma.booking.count({ where: { createdAt: { gte: today } } }),
    prisma.booking.count({ where: { status: { in: ACTIVE_BOOKING_STATUSES } } }),
    prisma.booking.count({ where: { status: 'REQUESTED' } }),
    prisma.booking.count({ where: { status: 'COMPLETED' } }),
    prisma.invoice.count({ where: { status: { in: ['ISSUED', 'OVERDUE'] } } }),
    // Revenue = invoices actually settled by the payment provider.
    prisma.invoice.aggregate({
      where: { status: 'PAID' },
      _sum: { totalPaise: true },
    }),
    prisma.materialOrder.count(),
    prisma.messageThread.count({ where: { status: { in: ['OPEN', 'PENDING'] } } }),
    prisma.review.count({ where: { isApproved: false } }),
    // Catalogue coverage. These are real counts from the catalogue tables, so
    // an empty database honestly reads zero rather than showing a placeholder.
    prisma.category.count(),
    prisma.category.count({ where: { isActive: true } }),
    prisma.service.count(),
    prisma.service.count({ where: { isActive: true } }),
    prisma.serviceOption.count({ where: { isActive: true, pricePaise: { not: null } } }),
    prisma.serviceOption.count({ where: { isActive: true, pricePaise: null } }),
    prisma.booking.findMany({
      where: { createdAt: { gte: weekAgo } },
      select: { createdAt: true },
    }),
    prisma.booking.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  // Build a dense 7-day series so the chart has no gaps.
  const trendMap = new Map<string, number>();
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(weekAgo.getTime() + i * 24 * 60 * 60 * 1000);
    trendMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const row of trendRows) {
    const key = row.createdAt.toISOString().slice(0, 10);
    if (trendMap.has(key)) trendMap.set(key, (trendMap.get(key) ?? 0) + 1);
  }

  return {
    totalUsers,
    activeCustomers,
    activeProviders,
    activeTechnicians,
    newBookingsToday,
    activeBookings,
    pendingBookings,
    completedBookings,
    pendingPayments,
    revenuePaise: revenue._sum.totalPaise ?? 0,
    materialOrders,
    openSupportRequests,
    pendingReviews,
    categories,
    activeCategories,
    totalServices,
    activeServices,
    publishedPrices,
    unpublishedPrices,
    bookingTrend: [...trendMap.entries()].map(([date, count]) => ({ date, count })),
    statusBreakdown: statusRows
      .map((r) => ({ status: r.status, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * Simple audit-log reader for the admin System section.
 * Metadata is a JSON string; it is parsed defensively and rendered as text
 * only, never as HTML.
 */
export async function listAuditLogs(opts: { page?: number; pageSize?: number; action?: string }) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));

  const where: Record<string, unknown> = {};
  if (opts.action) where.action = opts.action;

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      // No `metadata` returned to the table; it is fetched on the detail page
      // so the list view cannot be used to mine operational data.
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        actorRole: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}