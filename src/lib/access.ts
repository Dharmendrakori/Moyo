import 'server-only';
import type { Role } from './domain';
import { prisma } from './prisma';
import { audit } from './audit';

/**
 * OBJECT-LEVEL AUTHORIZATION (IDOR PREVENTION)
 *
 * Every read of an individual record goes through one of these helpers. The
 * pattern is intentional: the query itself is scoped by ownership columns, so
 * a record belonging to someone else is never loaded into memory and therefore
 * cannot leak through a later serialization mistake.
 *
 * NEVER fetch by id alone and check afterwards.
 */

/** Narrow, safe projection of a booking for its owning customer. */
const CUSTOMER_BOOKING_SELECT = {
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
  customerId: true,
  service: { select: { id: true, name: true, slug: true, serviceType: true } },
  provider: {
    select: { id: true, displayName: true, contactPhone: true, whatsappNumber: true },
  },
  technician: { select: { id: true, displayName: true, headline: true, phone: true } },
  invoice: {
    select: {
      id: true,
      number: true,
      status: true,
      subtotalPaise: true,
      taxPaise: true,
      totalPaise: true,
      currency: true,
    },
  },
} as const;

export const bookingForCustomerSelect = CUSTOMER_BOOKING_SELECT;

/**
 * Loads a booking ONLY if the actor is allowed to see it:
 *  - ADMIN: always
 *  - PROVIDER: only bookings belonging to that provider
 *  - TECHNICIAN: only bookings assigned to that technician
 *  - CUSTOMER: only their own bookings
 *
 * Returns null when not found OR not permitted, so callers cannot distinguish
 * "does not exist" from "not yours" - that distinction leaks user data.
 */
export async function loadBookingForActor(
  bookingId: string,
  actor: { id: string; role: Role; providerId: string | null; technicianId: string | null },
) {
  const where = ownershipWhere(bookingId, actor);
  if (!where) return null;

  return prisma.booking.findFirst({
    where,
    select: {
      ...CUSTOMER_BOOKING_SELECT,
      technicianId: true,
      providerId: true,
      payments: {
        select: {
          id: true,
          status: true,
          amountPaise: true,
          currency: true,
          createdAt: true,
          // Deliberately excludes providerRef, idempotencyKey and any raw data.
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}

/** Builds the Prisma `where` clause that scopes a booking to the actor. */
export function ownershipWhere(
  bookingId: string,
  actor: { role: Role; id: string; providerId: string | null; technicianId: string | null },
): { id: string } & Record<string, unknown> {
  const base = { id: bookingId };

  switch (actor.role) {
    case 'ADMIN':
      return base;
    case 'CUSTOMER':
      return { ...base, customerId: actor.id };
    case 'PROVIDER':
      // A provider only exists with a providerId; otherwise no access at all.
      return actor.providerId ? { ...base, providerId: actor.providerId } : { id: '__none__' };
    case 'TECHNICIAN':
      return actor.technicianId ? { ...base, technicianId: actor.technicianId } : { id: '__none__' };
    default:
      return { id: '__none__' };
  }
}

/** Admin may read everything; provider scoped to own record; technician to own. */
export async function assertCanManageBooking(
  bookingId: string,
  actor: { id: string; role: Role; providerId: string | null; technicianId: string | null },
) {
  const booking = await prisma.booking.findFirst({
    where: ownershipWhere(bookingId, actor),
    select: { id: true, status: true, providerId: true, technicianId: true, customerId: true },
  });

  if (!booking) {
    await audit({
      action: 'ACCESS_DENIED',
      entityType: 'Booking',
      entityId: bookingId,
      actorId: actor.id,
      actorRole: actor.role,
    });
    return null;
  }

  return booking;
}