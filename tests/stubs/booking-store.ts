/// <reference types="vitest/globals" />

import { createHash } from 'node:crypto';
import { sessionState } from './session-control';

/**
 * Shared in-memory Prisma fixture for the admin booking route suites.
 *
 * It implements only the queries the booking routes actually issue, and mirrors
 * the two behaviours the routes depend on:
 *
 *  - `booking.findFirst` honours the ownership scope in `where`, exactly as
 *    `ownershipWhere()` builds it,
 *  - `booking.update` is CONDITIONAL on `where.status`, which is the concurrency
 *    guard the confirm/assign handlers rely on: a racing change means zero rows
 *    are written.
 *
 * Not a Prisma emulator: anything a test does not exercise is absent on purpose.
 */

export const ADMIN_ID = 'cadmin0000000000000000001';
export const CUSTOMER_ID = 'ccustomer00000000000000001';
export const BOOKING_ID = 'cbooking0000000000000001';
export const TECHNICIAN_ID = 'ctechnician00000000000001';
export const ORIGIN = 'http://localhost:3000';
export const CSRF = 'csrf-token';

export type BookingRow = {
  id: string;
  reference: string;
  status: string;
  providerId: string | null;
  technicianId: string | null;
  customerId: string;
};

export const bookingRows: BookingRow[] = [];
export const technicianRows: Array<{
  id: string;
  displayName: string;
  isActive: boolean;
  /** Assignment now requires an explicitly available technician. */
  isAvailable?: boolean;
  providerId?: string;
}> = [];
export const eventRows: Array<{
  bookingId: string;
  from: string | null;
  to: string;
  actorRole: string | null;
}> = [];
export const auditRows: Array<{ action: string }> = [];

/** Which `select` the last `booking.findFirst` was issued with. */
export const probe: { lastSelect: Record<string, unknown> | null } = { lastSelect: null };

export function seedBooking(
  row: Partial<BookingRow> & { id: string; reference: string; status: string },
): BookingRow {
  const full: BookingRow = {
    providerId: null,
    technicianId: null,
    customerId: 'ccustomer00000000000000002',
    ...row,
  };
  bookingRows.push(full);
  return full;
}

/** Mirrors `sha256` from src/lib/crypto.ts, which the session lookup uses. */
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/** Builds the Prisma double. Every suite registers its own instance. */
export function makePrismaMock() {
  const now = new Date();
  const prisma: Record<string, unknown> = {
    session: {
      findUnique: async ({ where }: { where?: { tokenHash?: string } } = {}) => {
        const userId = sessionState.currentUserId;
        if (!userId) return null;
        // The cookie value is `token-<id>`, stored hashed. A wrong hash means
        // "no such session", exactly like the real lookup.
        if (where?.tokenHash !== hash(`token-${userId}`)) return null;
        return {
          csrfToken: sessionState.csrfByUserId.get(userId) ?? CSRF,
          revokedAt: null,
          expiresAt: new Date(now.getTime() + 3_600_000),
          userId,
          user: {
            id: userId,
            name: userId === ADMIN_ID ? 'Ops Admin' : 'Test Customer',
            email: `${userId}@example.com`,
            phone: '9876543210',
            role: userId === ADMIN_ID ? 'ADMIN' : 'CUSTOMER',
            isActive: true,
            provider: null,
            technician: null,
          },
        };
      },
    },
    booking: {
      findFirst: async (args: {
        where?: Record<string, unknown>;
        select?: Record<string, unknown>;
      }) => {
        probe.lastSelect = args.select ?? null;
        const id = String(args.where?.id ?? '');
        const row = bookingRows.find((b) => b.id === id);
        if (!row) return null;
        const customerId = args.where?.customerId;
        if (typeof customerId === 'string' && row.customerId !== customerId) return null;
        return detailOf(row);
      },
      findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, unknown> }) => {
        probe.lastSelect = select ?? null;
        const row = bookingRows.find((b) => b.id === where.id);
        return row ? detailOf(row) : null;
      },
      update: async (args: {
        where: { id: string; status?: string };
        data: Record<string, unknown>;
      }) => {
        const row = bookingRows.find((b) => b.id === args.where.id);
        if (!row) return null;
        if (args.where.status && row.status !== args.where.status) return null;
        Object.assign(row, args.data);
        return {
          id: row.id,
          reference: row.reference,
          status: row.status,
          technicianId: row.technicianId,
        };
      },
    },
    bookingStatusEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        eventRows.push({
          bookingId: String(data.bookingId),
          from: (data.from as string) ?? null,
          to: String(data.to),
          actorRole: (data.actorRole as string) ?? null,
        });
        return { id: 'cevent000000000000000009' };
      },
    },
    technician: {
      /**
       * Mirrors `assertAssignableTechnician`: the query filters by id and (when
       * present) provider only. Activation and availability are returned as data
       * so the SHARED HELPER decides, exactly as it does in production.
       */
      findFirst: async ({
        where,
      }: {
        where: { id: string; isActive?: boolean; providerId?: string };
      }) => {
        const row = technicianRows.find((t) => t.id === where.id);
        if (!row) return null;
        if (where.providerId && row.providerId && row.providerId !== where.providerId) return null;
        if (where.isActive && !row.isActive) return null;
        return {
          id: row.id,
          displayName: row.displayName,
          isActive: row.isActive,
          isAvailable: row.isAvailable ?? false,
        };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditRows.push({ action: String(data.action) });
        return undefined;
      },
    },
  };
  // The booking handlers wrap their writes in a transaction.
  prisma.$transaction = async (fn: (tx: Record<string, unknown>) => unknown) => fn(prisma);
  return prisma;
}

export function resetBookingStore(): void {
  bookingRows.length = 0;
  technicianRows.length = 0;
  eventRows.length = 0;
  auditRows.length = 0;
  probe.lastSelect = null;
}

/** The stored detail projection, assembled from the in-memory rows. */
export function detailOf(row: BookingRow) {
  return {
    ...row,
    mode: 'INSTANT',
    serviceType: 'REPAIR',
    charging: 'VISIT_CHARGE',
    quotedPaise: 50_000,
    budgetMinPaise: null,
    budgetMaxPaise: null,
    scheduledFor: null,
    addressLine1: '12 Test Street',
    addressLine2: null,
    area: 'Indiranagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560038',
    landmark: null,
    contactName: 'Asha Verma',
    contactPhone: '9876543210',
    description: 'AC not cooling',
    isEmergency: false,
    createdAt: new Date('2026-01-02T09:00:00Z'),
    updatedAt: new Date('2026-01-02T09:00:00Z'),
    customer: {
      id: row.customerId,
      name: 'Asha Verma',
      email: 'asha@example.com',
      phone: '9876543210',
      createdAt: new Date('2025-12-01T09:00:00Z'),
    },
    service: {
      id: 'cservice00000000000000001',
      name: 'AC Repair',
      slug: 'ac-repair',
      serviceType: 'REPAIR',
      subCategory: { name: 'Air Conditioner', category: { name: 'Home appliances' } },
    },
    provider: null,
    technician: row.technicianId
      ? {
          id: row.technicianId,
          displayName: 'Ravi Kumar',
          headline: 'AC specialist',
          phone: '9876500000',
          skills: 'AC',
          isActive: true,
          isAvailable: true,
        }
      : null,
    statusEvents: eventRows
      .filter((event) => event.bookingId === row.id)
      .map((event, index) => ({
        id: `cevent0000000000000000${index}`,
        from: event.from,
        to: event.to,
        actorRole: event.actorRole,
        note: null,
        createdAt: new Date('2026-01-03T09:00:00Z'),
      })),
    invoice: null,
  };
}
