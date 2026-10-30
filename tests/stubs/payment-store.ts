/**
 * IN-MEMORY PAYMENT STORE for the payment route tests.
 *
 * A small, honest model of the Prisma operations the payment ledger performs -
 * NOT a Prisma emulator. Every conditional update the ledger relies on
 * (`updateMany` with a status allowlist, a unique gateway payment id, a unique
 * webhook event id) is implemented, because those conditions ARE the safety
 * property under test: a mock that ignored `where` would let a broken ledger
 * pass the concurrency and idempotency tests.
 *
 * Money stays integer paise here, exactly as in the database.
 */

import { createHash } from 'node:crypto';

export type BookingRow = {
  id: string;
  reference: string;
  status: string;
  customerId: string;
  providerId: string | null;
};

export type InvoiceRow = {
  id: string;
  number: string;
  bookingId: string;
  customerId: string;
  status: string;
  totalPaise: number;
  currency: string;
  issuedAt: Date | null;
  paidAt: Date | null;
};

export type PaymentRow = {
  id: string;
  idempotencyKey: string;
  invoiceId: string;
  bookingId: string;
  provider: string;
  status: string;
  amountPaise: number;
  currency: string;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  failureCode: string | null;
  failureReason: string | null;
  refundedPaise: number;
  refundStatus: string | null;
  signatureVerified: boolean;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type Where = Record<string, unknown> | undefined;

/** Prisma's unique-violation error, in the shape the ledger detects. */
const unique = (code = 'P2002') => Object.assign(new Error('Unique constraint failed'), { code });

/** Prisma-ish match: equality, `{ in: [...] }`, `{ notIn: [...] }`, `null`, `contains`. */
function matches(row: Record<string, unknown>, where: Where): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const clause = expected as { in?: unknown[]; notIn?: unknown[]; contains?: string };
      if (clause.in) return clause.in.includes(actual);
      if (clause.notIn) return !clause.notIn.includes(actual);
      if (typeof clause.contains === 'string') {
        return typeof actual === 'string' && actual.includes(clause.contains);
      }
    }
    return actual === expected;
  });
}

/** Mirrors `sha256()` from src/lib/crypto for the session stub. */
export function hashValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createPaymentStore() {
  let payments: PaymentRow[] = [];
  let invoices: InvoiceRow[] = [];
  let bookings: BookingRow[] = [];
  let webhookEvents: Array<{ eventId: string; type: string; paymentId: string | null }> = [];
  let notifications: Array<{ userId: string; title: string }> = [];
  let audits: Array<{ action: string; metadata?: string }> = [];
  let statusEvents: Array<{ bookingId: string; from: string | null; to: string }> = [];
  let sequence = 0;
  /** When set, the NEXT invoice.updateMany throws (rollback/idempotency test). */
  let failNextInvoiceUpdate = false;

  const now = Date.now();
  const nextId = (prefix: string) => `${prefix}${String(++sequence).padStart(10, '0')}`;

  const api = {
    rows: () => payments,
    invoiceRows: () => invoices,
    webhookEvents: () => webhookEvents,
    notifications: () => notifications,
    audits: () => audits,
    statusEvents: () => statusEvents,
    failNextInvoiceUpdate: () => {
      failNextInvoiceUpdate = true;
    },
    seedBooking(row: Partial<BookingRow> & { id: string }): BookingRow {
      const full: BookingRow = {
        reference: 'SERIC-2026-000123',
        status: 'PAYMENT_PENDING',
        customerId: 'ccustomer00000000000000001',
        providerId: 'cprovider0000000000000001',
        ...row,
      };
      bookings.push(full);
      return full;
    },
    seedInvoice(row: Partial<InvoiceRow> & { id: string; bookingId: string }): InvoiceRow {
      const full: InvoiceRow = {
        number: 'SERIC-INV-2026-000001',
        customerId: 'ccustomer00000000000000001',
        status: 'ISSUED',
        totalPaise: 149_900,
        currency: 'INR',
        issuedAt: new Date('2026-10-30T09:00:00Z'),
        paidAt: null,
        ...row,
      };
      invoices.push(full);
      return full;
    },
    seedPayment(row: Partial<PaymentRow> & { idempotencyKey: string; invoiceId: string }): PaymentRow {
      const full: PaymentRow = {
        id: nextId('cpay'),
        bookingId: 'cbooking0000000000000001',
        provider: 'RAZORPAY',
        status: 'PENDING',
        amountPaise: 149_900,
        currency: 'INR',
        gatewayOrderId: 'order_TESTORDER0001',
        gatewayPaymentId: null,
        failureCode: null,
        failureReason: null,
        refundedPaise: 0,
        refundStatus: null,
        signatureVerified: false,
        verifiedAt: null,
        createdAt: new Date(now),
        updatedAt: new Date(now),
        ...row,
      };
      payments.push(full);
      return full;
    },
    reset(): void {
      payments = [];
      invoices = [];
      bookings = [];
      webhookEvents = [];
      notifications = [];
      audits = [];
      statusEvents = [];
      sequence = 0;
      failNextInvoiceUpdate = false;
    },
  };

  /** Applies a write, enforcing the unique gateway payment id like the column. */
  function applyUpdate(row: PaymentRow, data: Record<string, unknown>): void {
    const next: PaymentRow = { ...row, ...(data as Partial<PaymentRow>), updatedAt: new Date() };
    if (
      next.gatewayPaymentId &&
      payments.some((p) => p.id !== row.id && p.gatewayPaymentId === next.gatewayPaymentId)
    ) {
      throw unique();
    }
    Object.assign(row, next);
  }

  const sessionState = (
    globalThis as unknown as {
      __moyoTestSessionState?: {
        currentUserId: string | null;
        csrfByUserId: Map<string, string>;
      };
    }
  ).__moyoTestSessionState;

  const prisma: Record<string, unknown> = {
    session: {
      findUnique: async ({ where }: { where?: { tokenHash?: string } } = {}) => {
        const userId = sessionState?.currentUserId;
        if (!userId) return null;
        if (where?.tokenHash !== hashValue(`token-${userId}`)) return null;
        const isAdmin = userId.startsWith('cadmin');
        return {
          csrfToken: sessionState?.csrfByUserId.get(userId) ?? 'csrf-token',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 3_600_000),
          userId,
          user: {
            id: userId,
            name: isAdmin ? 'Ops Admin' : 'Test Customer',
            email: `${userId}@example.com`,
            phone: '9876543210',
            role: isAdmin ? 'ADMIN' : 'CUSTOMER',
            isActive: true,
            provider: null,
            technician: null,
          },
        };
      },
    },

    invoice: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        invoices.find((row) => matches(row as unknown as Record<string, unknown>, where)) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) =>
        invoices.find((row) => row.id === where.id) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        // A simulated database failure: nothing in this call is committed.
        if (failNextInvoiceUpdate) {
          failNextInvoiceUpdate = false;
          throw new Error('simulated database failure');
        }
        let count = 0;
        for (const row of invoices) {
          if (matches(row as unknown as Record<string, unknown>, where)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },

    payment: {
      findUnique: async ({
        where,
      }: {
        where: {
          id?: string;
          idempotencyKey?: string;
          gatewayOrderId?: string;
          gatewayPaymentId?: string;
        };
      }) => {
        const row = payments.find(
          (p) =>
            (where.id !== undefined && p.id === where.id) ||
            (where.idempotencyKey !== undefined && p.idempotencyKey === where.idempotencyKey) ||
            (where.gatewayOrderId !== undefined && p.gatewayOrderId === where.gatewayOrderId) ||
            (where.gatewayPaymentId !== undefined && p.gatewayPaymentId === where.gatewayPaymentId),
        );
        return row ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (payments.some((p) => p.idempotencyKey === data.idempotencyKey)) throw unique();
        // A new attempt has no gateway order yet; that is the ledger's next step.
        return api.seedPayment({
          gatewayOrderId: null,
          status: 'CREATED',
          ...(data as unknown as Partial<PaymentRow> & {
            idempotencyKey: string;
            invoiceId: string;
          }),
        });
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const row of payments) {
          if (matches(row as unknown as Record<string, unknown>, where)) {
            applyUpdate(row, data);
            count += 1;
          }
        }
        return { count };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = payments.find((p) => p.id === where.id);
        if (!row) throw new Error('record not found');
        applyUpdate(row, data);
        return row;
      },
      count: async ({ where }: { where?: Record<string, unknown> } = {}) =>
        payments.filter((row) => matches(row as unknown as Record<string, unknown>, where)).length,
      aggregate: async ({ where }: { where?: Record<string, unknown> } = {}) => {
        const rows = payments.filter((row) =>
          matches(row as unknown as Record<string, unknown>, where),
        );
        return { _sum: { amountPaise: rows.reduce((sum, row) => sum + row.amountPaise, 0) } };
      },
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
        payments
          .filter((row) => matches(row as unknown as Record<string, unknown>, where))
          .map((row) => {
            const invoice = invoices.find((i) => i.id === row.invoiceId);
            const booking = bookings.find((b) => b.id === row.bookingId);
            return {
              ...row,
              invoice: invoice
                ? { id: invoice.id, number: invoice.number, customer: { name: 'Asha Verma' } }
                : null,
              booking: booking ? { id: booking.id, reference: booking.reference } : null,
            };
          }),
    },

    paymentWebhookEvent: {
      create: async ({ data }: { data: { eventId: string; type: string } }) => {
        if (webhookEvents.some((e) => e.eventId === data.eventId)) throw unique();
        const row = { eventId: data.eventId, type: data.type, paymentId: null };
        webhookEvents.push(row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { eventId: string; paymentId: null };
        data: { paymentId: string };
      }) => {
        let count = 0;
        for (const row of webhookEvents) {
          if (row.eventId === where.eventId && row.paymentId === null) {
            row.paymentId = data.paymentId;
            count += 1;
          }
        }
        return { count };
      },
      deleteMany: async ({ where }: { where: { eventId: string } }) => {
        const before = webhookEvents.length;
        webhookEvents = webhookEvents.filter((row) => row.eventId !== where.eventId);
        return { count: before - webhookEvents.length };
      },
    },

    booking: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        bookings.find((row) => row.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = bookings.find((b) => b.id === where.id);
        if (!row) throw new Error('record not found');
        Object.assign(row, data);
        return row;
      },
    },

    bookingStatusEvent: {
      create: async ({ data }: { data: { bookingId: string; from: string | null; to: string } }) => {
        statusEvents.push({ bookingId: data.bookingId, from: data.from, to: data.to });
        return data;
      },
    },

    notification: {
      create: async ({ data }: { data: { userId: string; title: string } }) => {
        notifications.push({ userId: data.userId, title: data.title });
        return data;
      },
    },

    auditLog: {
      create: async ({ data }: { data: { action: string; metadata?: string } }) => {
        audits.push({ action: data.action, metadata: data.metadata });
        return data;
      },
    },

    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      // Snapshot/restore so a throw inside the transaction leaves no partial
      // write behind - the property the ledger's rollback test depends on.
      const snapshot = {
        payments: payments.map((row) => ({ ...row })),
        invoices: invoices.map((row) => ({ ...row })),
        bookings: bookings.map((row) => ({ ...row })),
        statusEvents: [...statusEvents],
        notifications: [...notifications],
      };
      try {
        return await fn(prisma);
      } catch (err) {
        payments = snapshot.payments;
        invoices = snapshot.invoices;
        bookings = snapshot.bookings;
        statusEvents = snapshot.statusEvents;
        notifications = snapshot.notifications;
        throw err;
      }
    },
  };

  return { ...api, makePrismaMock: () => prisma };
}
