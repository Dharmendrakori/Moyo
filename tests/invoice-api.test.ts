/// <reference types="vitest/globals" />

/**
 * INVOICE ROUTE TESTS
 *
 * These drive the REAL route handlers, so the genuine guard chain executes on
 * every call: assertSameOrigin -> requireAdmin/requireUser -> assertCsrf ->
 * rate limit -> strict Zod -> the invoice library. Only Prisma and `next/headers`
 * are mocked (an in-memory ledger, not a Prisma emulator), which is the same
 * approach the booking route suites use.
 */

import { createHash } from 'node:crypto';
import { resetSessions, sessionState, signIn } from './stubs/session-control';
import { resetRateLimit } from '../src/lib/rate-limit';

vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));
vi.mock('../src/lib/prisma', () => ({ prisma: makePrismaMock() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

const ADMIN_ID = 'cadmin0000000000000000001';
const CUSTOMER_ID = 'ccustomer00000000000000001';
const OTHER_CUSTOMER_ID = 'ccustomer00000000000000009';
const BOOKING_ID = 'cbooking0000000000000001';
const OTHER_BOOKING_ID = 'cbooking0000000000000002';
const ORIGIN = 'http://localhost:3000';
const CSRF = 'csrf-token';

type BookingSeed = {
  id: string;
  reference: string;
  status: string;
  charging: string;
  quotedPaise: number | null;
  customerId: string;
  providerId: string | null;
};

type InvoiceRow = {
  id: string;
  number: string;
  status: string;
  bookingId: string;
  customerId: string;
  providerId: string | null;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  currency: string;
  taxRateBps: number;
  issuedAt: Date;
  createdAt: Date;
  sellerSnapshot: string;
  customerSnapshot: string;
  lineItems: Array<{
    description: string;
    charging: string | null;
    quantity: number;
    unitPaise: number;
    amountPaise: number;
  }>;
};

const bookings: BookingSeed[] = [];
const invoices: InvoiceRow[] = [];
const counters = new Map<string, number>();
const events: Array<{ bookingId: string; from: string | null; to: string; actorRole: string | null }> =
  [];
const audits: Array<{ action: string; metadata?: string }> = [];

function seedBooking(row: Partial<BookingSeed> & { id: string }): BookingSeed {
  const full: BookingSeed = {
    reference: 'SERIC-2026-000123',
    status: 'COMPLETED',
    charging: 'FIXED_CHARGE',
    quotedPaise: 149_900,
    customerId: CUSTOMER_ID,
    providerId: 'cprovider0000000000000001',
    ...row,
  };
  bookings.push(full);
  return full;
}

const PROVIDER = {
  id: 'cprovider0000000000000001',
  displayName: 'Seric Tech Solutions',
  legalName: 'Seric Tech Solutions',
  registeredAddress: 'Royal Market, Bhopal, Madhya Pradesh 462030',
  contactEmail: 'hello@example.com',
  contactPhone: '917047172454',
  gstin: null,
};

function bookingRecord(row: BookingSeed) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    charging: row.charging,
    quotedPaise: row.quotedPaise,
    addressLine1: '12 Test Street',
    addressLine2: null,
    area: 'Indiranagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560038',
    contactName: row.customerId === CUSTOMER_ID ? 'Asha Verma' : 'Ravi Shah',
    contactPhone: '9876543210',
    customerId: row.customerId,
    service: { name: 'AC Repair' },
    provider: row.providerId ? PROVIDER : null,
    invoice: invoices.find((i) => i.bookingId === row.id) ?? null,
  };
}


/** Hydrates a stored invoice the way the Prisma `select` would. */
function invoiceRecord(row: InvoiceRow) {
  const booking = bookings.find((b) => b.id === row.bookingId);
  return {
    ...row,
    booking: {
      id: row.bookingId,
      reference: booking?.reference ?? 'SERIC-2026-000123',
      serviceType: 'REPAIR',
    },
    customer: {
      name: row.customerId === CUSTOMER_ID ? 'Asha Verma' : 'Ravi Shah',
    },
    lineItems: row.lineItems.map((line, index) => ({
      id: `cline00000000000000000${index}`,
      ...line,
    })),
  };
}

function applyInvoiceWhere(where: Record<string, unknown> | undefined, row: InvoiceRow): boolean {
  if (!where) return true;
  if (typeof where.status === 'string' && row.status !== where.status) return false;
  if (typeof where.customerId === 'string' && row.customerId !== where.customerId) return false;
  if (typeof where.bookingId === 'string' && row.bookingId !== where.bookingId) return false;

  const or = where.OR as Array<Record<string, unknown>> | undefined;
  if (or) {
    const booking = bookings.find((b) => b.id === row.bookingId);
    const name = row.customerId === CUSTOMER_ID ? 'Asha Verma' : 'Ravi Shah';
    const term = (value: unknown): string | null => {
      const contains = (value as { contains?: string } | undefined)?.contains;
      return typeof contains === 'string' ? contains : null;
    };

    const matches = or.some((clause) => {
      const number = term(clause.number);
      if (number) return row.number.includes(number);

      const reference = term((clause.booking as { reference?: unknown } | undefined)?.reference);
      if (reference) return Boolean(booking?.reference.includes(reference));

      const customerName = term((clause.customer as { name?: unknown } | undefined)?.name);
      if (customerName) return name.includes(customerName);

      return false;
    });
    if (!matches) return false;
  }
  return true;
}


function makePrismaMock() {
  // Real time, not a fixed date: `getCurrentUser` compares the session expiry
  // against the wall clock, so a pinned past date would read as an expired
  // session.
  const now = new Date();

  const prisma: Record<string, unknown> = {
    session: {
      findUnique: async ({ where }: { where?: { tokenHash?: string } } = {}) => {
        const userId = sessionState.currentUserId;
        if (!userId) return null;
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
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = bookings.find((b) => b.id === where.id);
        return row ? bookingRecord(row) : null;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status: string };
        data: { status: string };
      }) => {
        // Conditional exactly like the real `updateMany`: zero rows when the
        // stored status no longer matches, which is the concurrency guard.
        const row = bookings.find((b) => b.id === where.id && b.status === where.status);
        if (!row) return { count: 0 };
        row.status = data.status;
        return { count: 1 };
      },
    },
    bookingStatusEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push({
          bookingId: String(data.bookingId),
          from: (data.from as string) ?? null,
          to: String(data.to),
          actorRole: (data.actorRole as string) ?? null,
        });
        return { id: 'cevent000000000000000009' };
      },
    },
    counter: {
      upsert: async ({ where, create }: { where: { key: string }; create: { value: number } }) => {
        const next = (counters.get(where.key) ?? 0) + create.value;
        counters.set(where.key, next);
        return { key: where.key, value: next };
      },
    },
    invoice: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (invoices.some((i) => i.bookingId === data.bookingId)) {
          // Mirrors the database `bookingId @unique` constraint.
          const err = new Error('Unique constraint failed') as Error & { code: string };
          err.code = 'P2002';
          throw err;
        }

        const nested = data.lineItems as { create: InvoiceRow['lineItems'] };
        const row: InvoiceRow = {
          id: `cinvoice0000000000000000${invoices.length + 1}`,
          number: String(data.number),
          status: String(data.status),
          bookingId: String(data.bookingId),
          customerId: String(data.customerId),
          providerId: (data.providerId as string) ?? null,
          subtotalPaise: Number(data.subtotalPaise),
          taxPaise: Number(data.taxPaise),
          totalPaise: Number(data.totalPaise),
          currency: String(data.currency),
          taxRateBps: Number(data.taxRateBps),
          issuedAt: data.issuedAt as Date,
          createdAt: now,
          sellerSnapshot: String(data.sellerSnapshot),
          customerSnapshot: String(data.customerSnapshot),
          lineItems: nested.create,
        };
        invoices.push(row);
        return {
          id: row.id,
          number: row.number,
          totalPaise: row.totalPaise,
          currency: row.currency,
        };
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = invoices.find((i) => i.id === where.id);
        return row ? invoiceRecord(row) : null;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const row = invoices.find((i) => applyInvoiceWhere(where, i));
        return row ? invoiceRecord(row) : null;
      },
      findMany: async ({
        where,
        skip = 0,
        take = 20,
      }: {
        where?: Record<string, unknown>;
        skip?: number;
        take?: number;
      }) => {
        const rows = invoices
          .filter((i) => applyInvoiceWhere(where, i))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows.slice(skip, skip + take).map((row) => {
          const booking = bookings.find((b) => b.id === row.bookingId);
          return {
            id: row.id,
            number: row.number,
            status: row.status,
            totalPaise: row.totalPaise,
            currency: row.currency,
            issuedAt: row.issuedAt,
            createdAt: row.createdAt,
            booking: { id: row.bookingId, reference: booking?.reference ?? '' },
            customer: { name: row.customerId === CUSTOMER_ID ? 'Asha Verma' : 'Ravi Shah' },
          };
        });
      },
      count: async ({ where }: { where?: Record<string, unknown> } = {}) =>
        invoices.filter((i) => applyInvoiceWhere(where, i)).length,
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push({ action: String(data.action) });
        return undefined;
      },
    },
  };

  // Generation and every handler write inside a transaction.
  prisma.$transaction = async (fn: (tx: Record<string, unknown>) => unknown) => fn(prisma);
  return prisma;
}

function resetLedger(): void {
  bookings.length = 0;
  invoices.length = 0;
  counters.clear();
  events.length = 0;
  audits.length = 0;
}

/** The only stored booking; fails the test loudly if nothing was seeded. */
function onlyBooking(): BookingSeed {
  const row = bookings[0];
  if (!row) throw new Error('expected a booking to exist');
  return row;
}

/** The only stored invoice; fails the test loudly if none was issued. */
function onlyInvoice(): InvoiceRow {
  const row = invoices[0];
  if (!row) throw new Error('expected an invoice to have been issued');
  return row;
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadGenerate() {
  vi.resetModules();
  return (await import('../src/app/api/admin/bookings/[id]/invoice/route')).POST;
}
async function loadList() {
  vi.resetModules();
  return (await import('../src/app/api/admin/invoices/route')).GET;
}
async function loadAdminPdf() {
  vi.resetModules();
  return (await import('../src/app/api/admin/invoices/[id]/pdf/route')).GET;
}
async function loadCustomerPdf() {
  vi.resetModules();
  return (await import('../src/app/api/bookings/[id]/invoice/pdf/route')).GET;
}

const get = (path: string, origin = ORIGIN) =>
  new Request(`${ORIGIN}${path}`, { headers: { origin } });

const post = (path: string, body: unknown = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-csrf-token': CSRF },
    body: JSON.stringify(body),
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  resetSessions();
  resetRateLimit();
  resetLedger();
});


// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const invoicePath = (id: string) => `/api/admin/bookings/${id}/invoice`;

describe('POST /api/admin/bookings/:id/invoice: authorization', () => {
  it('rejects an unauthenticated caller', async () => {
    seedBooking({ id: BOOKING_ID });
    const generate = await loadGenerate();
    const res = await generate(post(invoicePath(BOOKING_ID)), params(BOOKING_ID));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    expect(invoices).toHaveLength(0);
  });

  it('rejects a CUSTOMER: a customer can never issue an invoice', async () => {
    seedBooking({ id: BOOKING_ID, customerId: CUSTOMER_ID });
    const generate = await loadGenerate();
    signIn(CUSTOMER_ID);
    const res = await generate(post(invoicePath(BOOKING_ID)), params(BOOKING_ID));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(invoices).toHaveLength(0);
  });

  it('rejects a cross-origin ADMIN request', async () => {
    seedBooking({ id: BOOKING_ID });
    const generate = await loadGenerate();
    signIn(ADMIN_ID);
    const res = await generate(
      new Request(`${ORIGIN}${invoicePath(BOOKING_ID)}`, {
        method: 'POST',
        headers: {
          origin: 'https://evil.example',
          'content-type': 'application/json',
          'x-csrf-token': CSRF,
        },
        body: '{}',
      }),
      params(BOOKING_ID),
    );
    expect(res.status).toBe(403);
    expect(invoices).toHaveLength(0);
  });

  it('rejects an ADMIN request without the CSRF token', async () => {
    seedBooking({ id: BOOKING_ID });
    const generate = await loadGenerate();
    signIn(ADMIN_ID);
    const res = await generate(
      new Request(`${ORIGIN}${invoicePath(BOOKING_ID)}`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: '{}',
      }),
      params(BOOKING_ID),
    );
    expect(res.status).toBe(403);
    expect(invoices).toHaveLength(0);
  });
});

describe('POST /api/admin/bookings/:id/invoice: eligibility and integrity', () => {
  it('issues an invoice for a completed booking, from the persisted price only', async () => {
    seedBooking({ id: BOOKING_ID, quotedPaise: 149_900 });
    const generate = await loadGenerate();
    signIn(ADMIN_ID);

    const res = await generate(post(invoicePath(BOOKING_ID)), params(BOOKING_ID));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.invoice.number).toMatch(/^SERIC-INV-\d{4}-000001$/);
    expect(body.invoice.totalPaise).toBe(149_900);

    expect(invoices).toHaveLength(1);
    const stored = onlyInvoice();
    expect(stored.status).toBe('ISSUED');
    expect(stored.subtotalPaise).toBe(149_900);
    expect(stored.taxPaise).toBe(0);
    expect(stored.totalPaise).toBe(149_900);
    expect(stored.taxRateBps).toBe(0);
    expect(stored.currency).toBe('INR');
    expect(stored.lineItems).toHaveLength(1);
    expect(stored.lineItems[0]).toMatchObject({
      description: 'AC Repair',
      charging: 'FIXED_CHARGE',
      quantity: 1,
      unitPaise: 149_900,
      amountPaise: 149_900,
    });

    // The booking advanced through the real state-machine edge and logged it.
    expect(onlyBooking().status).toBe('INVOICE_GENERATED');
    expect(events).toEqual([
      { bookingId: BOOKING_ID, from: 'COMPLETED', to: 'INVOICE_GENERATED', actorRole: 'ADMIN' },
    ]);
    expect(audits.map((a) => a.action)).toContain('INVOICE_CREATED');
  });

  it('refuses a booking that is not completed', async () => {
    seedBooking({ id: BOOKING_ID, status: 'REQUESTED' });
    const generate = await loadGenerate();
    signIn(ADMIN_ID);

    const res = await generate(post(invoicePath(BOOKING_ID)), params(BOOKING_ID));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_COMPLETED' } });
    expect(invoices).toHaveLength(0);
    expect(onlyBooking().status).toBe('REQUESTED');
  });

  it('refuses a customer-budget booking with no confirmed amount', async () => {
    seedBooking({ id: BOOKING_ID, charging: 'CUSTOMER_BUDGET', quotedPaise: null });
    const generate = await loadGenerate();
    signIn(ADMIN_ID);

    const res = await generate(post(invoicePath(BOOKING_ID)), params(BOOKING_ID));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'NO_CONFIRMED_PRICE' } });
    expect(invoices).toHaveLength(0);
  });

  it('refuses a repeated request and keeps exactly one invoice', async () => {
    seedBooking({ id: BOOKING_ID });
    const generate = await loadGenerate();
    signIn(ADMIN_ID);

    const first = await generate(post(invoicePath(BOOKING_ID)), params(BOOKING_ID));
    expect(first.status).toBe(201);

    const second = await generate(post(invoicePath(BOOKING_ID)), params(BOOKING_ID));
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: 'ALREADY_INVOICED' } });
    expect(invoices).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it('survives two simultaneous requests: one wins, one conflicts, one invoice', async () => {
    seedBooking({ id: BOOKING_ID });
    const generate = await loadGenerate();
    signIn(ADMIN_ID);

    const [a, b] = await Promise.all([
      generate(post(invoicePath(BOOKING_ID)), params(BOOKING_ID)),
      generate(post(invoicePath(BOOKING_ID)), params(BOOKING_ID)),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(invoices).toHaveLength(1);
  });

  it('numbers invoices sequentially and never repeats a number', async () => {
    seedBooking({ id: BOOKING_ID });
    seedBooking({ id: OTHER_BOOKING_ID, reference: 'SERIC-2026-000124' });
    const generate = await loadGenerate();
    signIn(ADMIN_ID);

    await generate(post(invoicePath(BOOKING_ID)), params(BOOKING_ID));
    await generate(post(invoicePath(OTHER_BOOKING_ID)), params(OTHER_BOOKING_ID));

    expect(invoices.map((i) => i.number)).toEqual([
      expect.stringMatching(/-000001$/),
      expect.stringMatching(/-000002$/),
    ]);
    expect(new Set(invoices.map((i) => i.number)).size).toBe(2);
  });

  it('rejects a body that tries to supply a price or an amount', async () => {
    seedBooking({ id: BOOKING_ID });
    const generate = await loadGenerate();
    signIn(ADMIN_ID);

    for (const body of [
      { amountPaise: 1 },
      { totalPaise: 1 },
      { taxRateBps: 1800 },
      { lineItems: [] },
      { status: 'PAID' },
    ]) {
      const res = await generate(post(invoicePath(BOOKING_ID), body), params(BOOKING_ID));
      expect(res.status).toBe(422);
    }
    expect(invoices).toHaveLength(0);
  });

  it('returns 404 for a missing booking and for a malformed id', async () => {
    const generate = await loadGenerate();
    signIn(ADMIN_ID);

    const missing = await generate(post(invoicePath(BOOKING_ID)), params(BOOKING_ID));
    expect(missing.status).toBe(404);

    const malformed = await generate(post(invoicePath('not-a-cuid')), params('not-a-cuid'));
    expect(malformed.status).toBe(404);
  });
});


// ---------------------------------------------------------------------------
// Immutability and the ledger
// ---------------------------------------------------------------------------

describe('issued invoices are immutable', () => {
  it('keeps its figures and snapshots after the booking price changes', async () => {
    const booking = seedBooking({ id: BOOKING_ID, quotedPaise: 149_900 });
    const generate = await loadGenerate();
    signIn(ADMIN_ID);
    await generate(post(invoicePath(BOOKING_ID)), params(BOOKING_ID));

    // A later catalogue/pricing change must not rewrite the issued invoice.
    booking.quotedPaise = 999_900;

    const pdf = await loadAdminPdf();
    const issued = onlyInvoice();
    const res = await pdf(get(`/api/admin/invoices/${issued.id}/pdf`), params(issued.id));
    const text = Buffer.from(await res.arrayBuffer()).toString('latin1');

    expect(issued.totalPaise).toBe(149_900);
    expect(text).toContain('INR 1,499.00');
    expect(text).not.toContain('INR 9,999.00');
  });

  it('keeps the seller and customer details as snapshotted at issue time', async () => {
    seedBooking({ id: BOOKING_ID });
    const generate = await loadGenerate();
    signIn(ADMIN_ID);
    await generate(post(invoicePath(BOOKING_ID)), params(BOOKING_ID));

    const stored = onlyInvoice();
    const seller = JSON.parse(stored.sellerSnapshot);

    // Snapshotted, not invented: the provider has no GSTIN configured.
    expect(seller).toMatchObject({ name: 'Seric Tech Solutions', gstin: null });
    expect(JSON.parse(stored.customerSnapshot)).toMatchObject({
      name: 'Asha Verma',
      address: '12 Test Street, Indiranagar, Bengaluru, Karnataka, 560038',
    });
  });
});

describe('GET /api/admin/invoices', () => {
  it('rejects an unauthenticated caller and a CUSTOMER', async () => {
    const list = await loadList();

    const anonymous = await list(get('/api/admin/invoices'));
    expect(anonymous.status).toBe(401);

    signIn(CUSTOMER_ID);
    const customer = await list(get('/api/admin/invoices'));
    expect(customer.status).toBe(403);
  });

  it('lists issued invoices for an ADMIN with search and paging', async () => {
    seedBooking({ id: BOOKING_ID, reference: 'SERIC-2026-000123' });
    seedBooking({ id: OTHER_BOOKING_ID, reference: 'SERIC-2026-000124' });
    const generate = await loadGenerate();
    signIn(ADMIN_ID);
    await generate(post(invoicePath(BOOKING_ID)), params(BOOKING_ID));
    await generate(post(invoicePath(OTHER_BOOKING_ID)), params(OTHER_BOOKING_ID));

    const list = await loadList();
    const res = await list(get('/api/admin/invoices'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.issuedTotal).toBe(2);
    expect(body.items[0]).toHaveProperty('number');
    expect(body.items[0]).toHaveProperty('booking');
    expect(body.items[0]).toHaveProperty('customer');

    const filtered = await list(get('/api/admin/invoices?q=000124'));
    expect((await filtered.json()).total).toBe(1);
  });

  it('rejects unknown parameters and free-form statuses', async () => {
    const list = await loadList();
    signIn(ADMIN_ID);
    for (const qs of ['?sort=desc', '?status=WHATEVER', '?page=0', '?pageSize=1000']) {
      const res = await list(get(`/api/admin/invoices${qs}`));
      expect(res.status).toBe(422);
    }
  });
});


// ---------------------------------------------------------------------------
// PDF downloads
// ---------------------------------------------------------------------------

const pdfPath = (id: string) => `/api/admin/invoices/${id}/pdf`;

describe('GET /api/admin/invoices/:id/pdf', () => {
  it('rejects an unauthenticated caller', async () => {
    const pdf = await loadAdminPdf();
    const res = await pdf(get(pdfPath('cinvoice00000000000000001')), params('cinvoice00000000000000001'));
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown invoice', async () => {
    const pdf = await loadAdminPdf();
    signIn(ADMIN_ID);
    const res = await pdf(get(pdfPath('cinvoice00000000000000009')), params('cinvoice00000000000000009'));
    expect(res.status).toBe(404);
  });

  it('serves a valid PDF download whose figures match the database', async () => {
    seedBooking({ id: BOOKING_ID, quotedPaise: 149_900 });
    const generate = await loadGenerate();
    signIn(ADMIN_ID);
    await generate(post(invoicePath(BOOKING_ID)), params(BOOKING_ID));

    const id = onlyInvoice().id;
    const pdf = await loadAdminPdf();
    const res = await pdf(get(pdfPath(id)), params(id));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('.pdf');
    expect(res.headers.get('cache-control')).toContain('no-store');

    const text = Buffer.from(await res.arrayBuffer()).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain(onlyInvoice().number);
    expect(text).toContain('INR 1,499.00');
  });
});

describe('GET /api/bookings/:id/invoice/pdf: customer access', () => {
  const customerPdfPath = (id: string) => `/api/bookings/${id}/invoice/pdf`;

  async function issueInvoice(): Promise<InvoiceRow> {
    seedBooking({ id: BOOKING_ID, customerId: CUSTOMER_ID });
    const generate = await loadGenerate();
    signIn(ADMIN_ID);
    await generate(post(invoicePath(BOOKING_ID)), params(BOOKING_ID));
    // Start every case signed out; each one signs in exactly the actor it tests.
    resetSessions();
    resetRateLimit();
    return onlyInvoice();
  }

  it('rejects an unauthenticated caller', async () => {
    await issueInvoice();
    const pdf = await loadCustomerPdf();
    const res = await pdf(get(customerPdfPath(BOOKING_ID)), params(BOOKING_ID));
    expect(res.status).toBe(401);
  });

  it('serves the owner their own invoice', async () => {
    const invoice = await issueInvoice();
    const pdf = await loadCustomerPdf();
    signIn(CUSTOMER_ID);

    const res = await pdf(get(customerPdfPath(BOOKING_ID)), params(BOOKING_ID));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');

    const text = Buffer.from(await res.arrayBuffer()).toString('latin1');
    expect(text).toContain(invoice.number);
    expect(text).toContain('INR 1,499.00');
  });

  it('refuses another customer, indistinguishably from a missing booking', async () => {
    await issueInvoice();
    const pdf = await loadCustomerPdf();
    signIn(OTHER_CUSTOMER_ID);

    const foreign = await pdf(get(customerPdfPath(BOOKING_ID)), params(BOOKING_ID));
    const missing = await pdf(get(customerPdfPath(OTHER_BOOKING_ID)), params(OTHER_BOOKING_ID));

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    // Same body, so the response cannot be used to probe which ids exist.
    expect(await foreign.json()).toEqual(await missing.json());
  });

  it('refuses an ADMIN through the customer endpoint, and a malformed id', async () => {
    await issueInvoice();
    const pdf = await loadCustomerPdf();

    // An administrator owns no booking, so this resolves to "not found" rather
    // than widening customer access by role.
    signIn(ADMIN_ID);
    const asAdmin = await pdf(get(customerPdfPath(BOOKING_ID)), params(BOOKING_ID));
    expect(asAdmin.status).toBe(404);

    signIn(CUSTOMER_ID);
    const malformed = await pdf(get(customerPdfPath('nope')), params('nope'));
    expect(malformed.status).toBe(404);
  });

  it('returns 404 when the booking has no invoice yet', async () => {
    seedBooking({ id: BOOKING_ID, status: 'SERVICE_IN_PROGRESS' });
    const pdf = await loadCustomerPdf();
    signIn(CUSTOMER_ID);

    const res = await pdf(get(customerPdfPath(BOOKING_ID)), params(BOOKING_ID));
    expect(res.status).toBe(404);
  });
});

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
