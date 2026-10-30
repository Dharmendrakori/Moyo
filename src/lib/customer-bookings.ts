import 'server-only';
import { prisma } from './prisma';
import { isBookingStatus } from './domain';
import { STATUS_LABEL, STATUS_HINT } from './booking-state';

/**
 * CUSTOMER BOOKING READS
 *
 * Every query here is scoped to the ACTING CUSTOMER'S OWN customerId. The owner
 * id is not a parameter of the customer-facing functions, so it can never be
 * supplied by a caller - which makes IDOR structurally impossible here.
 */

export type BookingListItem = {
  id: string;
  reference: string;
  status: string;
  statusLabel: string;
  statusHint: string;
  charging: string;
  quotedPaise: number | null;
  budgetMinPaise: number | null;
  budgetMaxPaise: number | null;
  scheduledFor: Date | null;
  createdAt: Date;
  service: { name: string; slug: string };
  providerName: string | null;
  technicianName: string | null;
};

export async function listCustomerBookings(
  customerId: string,
  opts: { status?: string; page?: number; pageSize?: number } = {},
): Promise<{ items: BookingListItem[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 10));

  // Only an exact, known status may be filtered on; anything else is ignored
  // rather than passed into the query.
  const statusFilter =
    opts.status && isBookingStatus(opts.status) ? { status: opts.status } : {};

  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where: { customerId, ...statusFilter },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        reference: true,
        status: true,
        charging: true,
        quotedPaise: true,
        budgetMinPaise: true,
        budgetMaxPaise: true,
        scheduledFor: true,
        createdAt: true,
        service: { select: { name: true, slug: true } },
        provider: { select: { displayName: true } },
        technician: { select: { displayName: true } },
      },
    }),
    prisma.booking.count({ where: { customerId, ...statusFilter } }),
  ]);

  return {
    items: rows.map((b) => ({
      id: b.id,
      reference: b.reference,
      status: b.status,
      statusLabel: isBookingStatus(b.status) ? STATUS_LABEL[b.status] : b.status,
      statusHint: isBookingStatus(b.status) ? STATUS_HINT[b.status] : '',
      charging: b.charging,
      quotedPaise: b.quotedPaise,
      budgetMinPaise: b.budgetMinPaise,
      budgetMaxPaise: b.budgetMaxPaise,
      scheduledFor: b.scheduledFor,
      createdAt: b.createdAt,
      service: b.service,
      providerName: b.provider?.displayName ?? null,
      technicianName: b.technician?.displayName ?? null,
    })),
    total,
  };
}

/**
 * Loads a single booking for a customer, scoped by ownership IN THE QUERY.
 * Returns null for someone else's booking, which is indistinguishable from
 * "not found" to the caller.
 */
export async function getCustomerBooking(customerId: string, bookingId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, customerId },
    select: {
      id: true,
      reference: true,
      status: true,
      mode: true,
      serviceType: true,
      charging: true,
      quotedPaise: true,
      budgetMinPaise: true,
      budgetMaxPaise: true,
      scheduledFor: true,
      addressLine1: true,
      addressLine2: true,
      area: true,
      city: true,
      state: true,
      pincode: true,
      landmark: true,
      contactName: true,
      contactPhone: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      isEmergency: true,
      // The category is required by the tracking page header, so it is joined
      // here rather than being fetched separately on each render.
      service: {
        select: {
          id: true,
          name: true,
          slug: true,
          serviceType: true,
          subCategory: { select: { category: { select: { name: true, slug: true } } } },
        },
      },
      provider: {
        select: { displayName: true, contactPhone: true, whatsappNumber: true },
      },
      technician: {
        select: { id: true, displayName: true, headline: true, phone: true, skills: true },
      },
      invoice: {
        select: {
          id: true,
          number: true,
          status: true,
          subtotalPaise: true,
          taxPaise: true,
          totalPaise: true,
          currency: true,
          issuedAt: true,
          lineItems: {
            select: { description: true, quantity: true, unitPaise: true, amountPaise: true },
          },
        },
      },
      // Only non-sensitive payment fields. No provider refs or idempotency keys.
      payments: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, amountPaise: true, currency: true, createdAt: true },
      },
      statusEvents: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, from: true, to: true, note: true, createdAt: true, actorRole: true },
      },
      review: { select: { id: true, rating: true, comment: true, createdAt: true } },
    },
  });

  if (!booking) return null;

  return {
    ...booking,
    statusLabel: isBookingStatus(booking.status) ? STATUS_LABEL[booking.status] : booking.status,
    statusHint: isBookingStatus(booking.status) ? STATUS_HINT[booking.status] : '',
  };
}

/** Whether a customer may leave feedback for a booking in its current state. */
export function canCustomerReview(status: string): boolean {
  return status === 'FEEDBACK_PENDING' || status === 'PAID' || status === 'CLOSED';
}

/**
 * Admin booking list.
 *
 * Admin is the only role permitted to see every booking, and this function is
 * only reachable from an admin-guarded route.
 *
 * Note the projection: no customer phone, email or full address is returned for
 * table rows. Admin tables must never expose unnecessary personal data.
 */
export async function listAllBookings(opts: {
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: AdminBookingRow[]; total: number; awaitingTotal: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));

  const where: Record<string, unknown> = {};
  if (opts.status && isBookingStatus(opts.status)) where.status = opts.status;
  // Prisma parameterises this value, so a search term cannot become SQL.
  if (opts.q) where.reference = { contains: opts.q };

  const [rows, total, awaitingTotal] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        reference: true,
        status: true,
        mode: true,
        charging: true,
        quotedPaise: true,
        createdAt: true,
        area: true,
        city: true,
        customer: { select: { id: true, name: true } },
        provider: { select: { id: true, displayName: true } },
        technician: { select: { id: true, displayName: true } },
        service: { select: { id: true, name: true } },
      },
    }),
    prisma.booking.count({ where }),
    // Whole-queue figure, independent of the current filter and page, so the
    // awaiting-confirmation indicator is never a page-local guess.
    prisma.booking.count({ where: { status: 'REQUESTED' } }),
  ]);

  return { items: rows, total, awaitingTotal };
}

/**
 * One booking with everything an administrator needs to dispatch it, for
 * `/admin/bookings/[id]`.
 *
 * Reachable only from an admin-guarded page. The projection is explicit and
 * minimised: it carries the contact details the JOB needs - the booking's own
 * `contactName` / `contactPhone`, which the customer supplied for this visit -
 * plus the account id and name as a support reference. It deliberately does NOT
 * project the customer account's email or phone: dispatch does not need them,
 * they are the same person's data under a different scope, and account-level
 * contact belongs to a future Customers module with its own access policy.
 * Password hashes, sessions, IP hashes and payment provider references are
 * never selected.
 *
 * The status history is the real append-only `BookingStatusEvent` log - there is
 * no second source of truth and no reconstructed timeline.
 */
export async function getAdminBookingDetail(bookingId: string) {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      reference: true,
      status: true,
      mode: true,
      serviceType: true,
      charging: true,
      quotedPaise: true,
      budgetMinPaise: true,
      budgetMaxPaise: true,
      scheduledFor: true,
      addressLine1: true,
      addressLine2: true,
      area: true,
      city: true,
      state: true,
      pincode: true,
      landmark: true,
      contactName: true,
      contactPhone: true,
      description: true,
      isEmergency: true,
      createdAt: true,
      updatedAt: true,
      customer: { select: { id: true, name: true, createdAt: true } },
      service: {
        select: {
          id: true,
          name: true,
          slug: true,
          serviceType: true,
          subCategory: { select: { name: true, category: { select: { name: true } } } },
        },
      },
      provider: { select: { id: true, displayName: true } },
      technician: {
        select: {
          id: true,
          displayName: true,
          headline: true,
          phone: true,
          skills: true,
          isActive: true,
          isAvailable: true,
        },
      },
      statusEvents: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, from: true, to: true, actorRole: true, note: true, createdAt: true },
      },
      invoice: {
        select: { id: true, number: true, status: true, totalPaise: true, currency: true, issuedAt: true },
      },
    },
  });
}

export type AdminBookingDetail = NonNullable<Awaited<ReturnType<typeof getAdminBookingDetail>>>;

export type AdminBookingRow = {
  id: string;
  reference: string;
  status: string;
  mode: string;
  charging: string;
  quotedPaise: number | null;
  createdAt: Date;
  area: string | null;
  city: string | null;
  customer: { id: string; name: string };
  provider: { id: string; displayName: string } | null;
  technician: { id: string; displayName: string } | null;
  service: { id: string; name: string };
};