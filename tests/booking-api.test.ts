/// <reference types="vitest/globals" />

/**
 * NOTE: this file relies on `globals: true` in vitest.config.mts rather than
 * importing from 'vitest'. The project configuration documents that as a
 * deliberate choice, because Vitest 5 does not resolve the named exports of the
 * `vitest` entrypoint reliably through the CommonJS interop path.
 */

/**
 * CUSTOMER BOOKING API TESTS
 *
 * These exercise the real route handlers with the database, `next/headers` and
 * `server-only` mocked, so the actual guard chain runs:
 *
 *   requireUser -> assertCsrf -> rate limit -> Zod parse -> domain service
 *
 * The cases below are the security properties this milestone must not regress:
 * unauthenticated access, CSRF, ownership isolation (IDOR), server-side
 * pricing, and mass-assignment defence.
 */

// --- Mocks (declared before importing the routes) ----------------------------

import { createHash } from 'node:crypto';
import { resetSessions, sessionState, signIn } from './stubs/session-control';
import { BUDGET_CEILING_PAISE } from '@/lib/validation';

const bookingRows: Array<Record<string, unknown>> = [];

/**
 * Mirrors `sha256` from src/lib/crypto.ts. The real implementation is used
 * because the session lookup key is a hash of the cookie token, so the mock has
 * to derive the same value to find the session.
 */
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * `getCurrentUser` is wrapped in React's `cache()`, which memoises per render
 * request. Outside a React render that memoisation outlives a single test, so
 * the first (signed-out) lookup would be reused by every later case and each
 * authenticated test would spuriously see 401. Overriding `cache` with a
 * pass-through makes each call resolve the session afresh - the behaviour the
 * production code gets inside a real request.
 */
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

/*
 * The route handlers import `@/lib/prisma` (the alias), so the mock MUST be
 * registered under the same specifier. Mocking the relative path leaves the
 * route resolving a DIFFERENT module instance whose session lookup never sees
 * the signed-in test state, and every authenticated test then fails with 401.
 */
vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));

/**
 * The mock Prisma client.
 *
 * Declared as a factory result rather than an inline object so `$transaction`
 * can delegate to the same model methods - the booking route wraps its writes in
 * a transaction, and the mock has to behave like the real client for those
 * calls to run at all.
 */
function makePrismaMock() {
  return {
    session: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const userId = sessionState.currentUserId;
        if (!userId) return null;
        // The cookie value is `token-<id>`, stored hashed.
        if (where.tokenHash !== hash(`token-${userId}`)) return null;
        return {
          csrfToken: sessionState.csrfByUserId.get(userId) ?? 'csrf-token',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 3_600_000),
          userId,
          user: {
            id: userId,
            name: 'Test Customer',
            email: 'customer@example.com',
            phone: '9876543210',
            role: 'CUSTOMER',
            isActive: true,
            provider: null,
            technician: null,
          },
        };
      },
    },
    service: {
      findFirst: async ({ where }: { where: { id?: string } }) =>
        where.id === 'cm1234567890123456789012'
          ? {
              id: where.id,
              serviceType: 'REPAIR',
              providers: [{ providerId: 'provider-1' }],
            }
          : null,
    },
    // Published price per charging option. Anything not listed behaves as "the
    // provider has not published a price", which is the honest default.
    serviceOption: {
      findFirst: async ({ where }: { where: { serviceId: string; charging: string } }) => {
        const published: Record<
          string,
          { pricePaise: number | null; min: number | null; max: number | null }
        > = {
          VISIT_CHARGE: { pricePaise: 50_000, min: null, max: null },
          FIXED_CHARGE: { pricePaise: 2_50_000, min: null, max: null },
          CUSTOMER_BUDGET: { pricePaise: null, min: 50_000, max: 5_00_000 },
        };
        const row = published[where.charging];
        if (!row) return null;
        return { pricePaise: row.pricePaise, budgetMinPaise: row.min, budgetMaxPaise: row.max };
      },
    },
    booking: {
      findFirst: async ({ where }: { where: { id: string; customerId: string } }) => {
        // Mirrors the real ownership-scoped query exactly: the customer's own
        // id is part of the WHERE clause, so a foreign id cannot match.
        const row = bookingRows.find((b) => b.id === where.id && b.customerId === where.customerId);
        return row ?? null;
      },
      findMany: async ({ where }: { where: { customerId: string } }) =>
        bookingRows.filter((b) => b.customerId === where.customerId),
      count: async ({ where }: { where: { customerId: string } }) =>
        bookingRows.filter((b) => b.customerId === where.customerId).length,
      /**
       * Returns the row the route would persist. `data` is the exact payload the
       * handler built, which is what makes the pricing assertions meaningful:
       * they read back what the SERVER decided, not what the client sent.
       */
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'booking-created',
        reference: data.reference,
        status: data.status,
        charging: data.charging,
        quotedPaise: data.quotedPaise,
        budgetMinPaise: data.budgetMinPaise,
        budgetMaxPaise: data.budgetMaxPaise,
        scheduledFor: data.scheduledFor,
        service: { name: 'Test Service' },
      }),
    },
    bookingStatusEvent: { create: async () => ({ id: 'event-1' }) },
    auditLog: { create: async () => undefined },
    notification: { create: async () => undefined },
    counter: { upsert: async () => ({ value: 1 }) },

    /**
     * Interactive-transaction stand-in. The real client hands the callback a
     * transaction-scoped client; here the callback simply runs against the same
     * mock, which is sufficient because the mock has no real isolation to model.
     */
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makePrismaMock()),
  };
}


/**
 * Handlers are imported INSIDE each test, after `vi.resetModules()`.
 *
 * `getCurrentUser` is wrapped in React's `cache()`, which memoises per render
 * request. Outside a React render that memoisation outlives a single test, so
 * the first (signed-out) lookup would be reused by every later case and each
 * authenticated test would spuriously see 401. Resetting the module registry
 * and re-importing gives each test the same isolation a real request has, and
 * guarantees the handler under test and the auth module it calls come from the
 * same fresh module graph.
 */
async function loadHandlers() {
  const bookings = await import('../src/app/api/bookings/route');
  const single = await import('../src/app/api/bookings/[id]/route');
  return { createBooking: bookings.POST, listBookings: bookings.GET, getBooking: single.GET };
}

const ORIGIN = 'http://localhost:3000';

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  resetSessions();
  bookingRows.length = 0;
  vi.resetModules();
});

const validBooking = {
  serviceId: 'cm1234567890123456789012',
  charging: 'VISIT_CHARGE',
  mode: 'INSTANT',
  address: {
    line1: 'Plot 14, Royal Market',
    area: 'Royal Market',
    city: 'Bhopal',
    state: 'Madhya Pradesh',
    pincode: '462030',
  },
  contactName: 'Rahul Sharma',
  contactPhone: '9876543210',
};

describe('POST /api/bookings', () => {
  it('rejects an unauthenticated booking attempt', async () => {
    const { createBooking } = await loadHandlers();
    const res = await createBooking(jsonRequest(validBooking));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('creates a booking for an authenticated customer', async () => {
    const { createBooking } = await loadHandlers();
    signIn('customer-1');
    const res = await createBooking(
      jsonRequest(validBooking, { 'x-csrf-token': 'csrf-token' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.booking.reference).toMatch(/^SERIC-\d{4}-\d{6}$/);
    expect(body.booking.status).toBe('REQUESTED');
  });

  /**
   * The price is resolved from the `ServiceOption` row by the server. The
   * client chooses WHICH option applies; it never chooses how much it costs.
   */
  it('resolves the price server-side, ignoring any client figure', async () => {
    const { createBooking } = await loadHandlers();
    signIn('customer-1');
    const res = await createBooking(
      jsonRequest(
        { ...validBooking, charging: 'FIXED_CHARGE' },
        { 'x-csrf-token': 'csrf-token' },
      ),
    );
    expect(res.status).toBe(201);
    // 2_50_000 paise = ₹2,500, taken from the mocked published option.
    expect((await res.json()).booking.quotedPaise).toBe(2_50_000);
  });

  it('records a customer budget without inventing a fixed quote', async () => {
    const { createBooking } = await loadHandlers();
    signIn('customer-1');
    const res = await createBooking(
      jsonRequest(
        {
          ...validBooking,
          charging: 'CUSTOMER_BUDGET',
          budgetMin: 100_000,
          budgetMax: 200_000,
        },
        { 'x-csrf-token': 'csrf-token' },
      ),
    );
    expect(res.status).toBe(201);
    const booking = (await res.json()).booking;
    expect(booking.quotedPaise).toBeNull();
    expect(booking.budgetMinPaise).toBe(100_000);
    expect(booking.budgetMaxPaise).toBe(200_000);
  });

  /**
   * Beyond the absolute ceiling (₹1 crore), so Zod rejects it before the
   * request ever reaches the pricing domain service.
   */
  it('rejects a budget beyond the absolute permitted ceiling', async () => {
    const { createBooking } = await loadHandlers();
    signIn('customer-1');
    const res = await createBooking(
      jsonRequest(
        {
          ...validBooking,
          charging: 'CUSTOMER_BUDGET',
          budgetMin: 50_000,
          budgetMax: BUDGET_CEILING_PAISE + 1,
        },
        { 'x-csrf-token': 'csrf-token' },
      ),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  /**
   * Inside the absolute ceiling but outside the range the PROVIDER published
   * (mock: 50,000 to 500,000 paise), so it passes Zod and is refused by the
   * pricing domain service instead.
   */
  it('rejects a budget outside the provider\'s published range', async () => {
    const { createBooking } = await loadHandlers();
    signIn('customer-1');
    const res = await createBooking(
      jsonRequest(
        {
          ...validBooking,
          charging: 'CUSTOMER_BUDGET',
          budgetMin: 60_000,
          budgetMax: 8_00_000,
        },
        { 'x-csrf-token': 'csrf-token' },
      ),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('BUDGET_OUT_OF_RANGE');
  });

  it('rejects a charging option the service does not offer', async () => {
    const { createBooking } = await loadHandlers();
    signIn('customer-1');
    // `SPARE_PARTS` pricing is not published for this service in the mock.
    const res = await createBooking(
      jsonRequest(
        { ...validBooking, serviceType: 'SPARE_PARTS', charging: 'SPARE_PARTS' },
        { 'x-csrf-token': 'csrf-token' },
      ),
    );
    expect(res.status).toBe(422);
  });

  it('rejects a booking with no CSRF token', async () => {
    const { createBooking } = await loadHandlers();
    signIn('customer-1');
    const res = await createBooking(jsonRequest(validBooking));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });

  it('rejects a booking with a wrong CSRF token', async () => {
    const { createBooking } = await loadHandlers();
    signIn('customer-1');
    const res = await createBooking(jsonRequest(validBooking, { 'x-csrf-token': 'forged' }));
    expect(res.status).toBe(403);
  });

  it('rejects a cross-origin booking request', async () => {
    const { createBooking } = await loadHandlers();
    signIn('customer-1');
    const res = await createBooking(
      jsonRequest(validBooking, { origin: 'https://evil.example', 'x-csrf-token': 'csrf-token' }),
    );
    expect(res.status).toBe(403);
  });

  it('rejects invalid input', async () => {
    const { createBooking } = await loadHandlers();
    signIn('customer-1');
    const res = await createBooking(
      jsonRequest({ ...validBooking, contactPhone: 'not-a-phone' }, { 'x-csrf-token': 'csrf-token' }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.fields).toHaveProperty('contactPhone');
  });

  it('rejects an invalid charging option', async () => {
    const { createBooking } = await loadHandlers();
    signIn('customer-1');
    const res = await createBooking(
      jsonRequest({ ...validBooking, charging: 'FREE_OF_CHARGE' }, { 'x-csrf-token': 'csrf-token' }),
    );
    expect(res.status).toBe(422);
  });

  it('rejects a customer budget that is missing bounds', async () => {
    const { createBooking } = await loadHandlers();
    signIn('customer-1');
    const res = await createBooking(
      jsonRequest(
        { ...validBooking, charging: 'CUSTOMER_BUDGET' },
        { 'x-csrf-token': 'csrf-token' },
      ),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.fields).toHaveProperty('budgetMin');
  });

  it('rejects a client-supplied price (mass-assignment defence)', async () => {
    const { createBooking } = await loadHandlers();
    signIn('customer-1');
    const res = await createBooking(
      jsonRequest(
        { ...validBooking, quotedPaise: 1, customerId: 'attacker', status: 'PAID' },
        { 'x-csrf-token': 'csrf-token' },
      ),
    );
    expect(res.status).toBe(422);
  });

  it('refuses to book a service that does not exist', async () => {
    const { createBooking } = await loadHandlers();
    // A distinct user id: the booking rate limit is 10/hour per user, and this
    // case must not be rejected by throttling before it reaches the lookup.
    signIn('customer-unknown-service');
    const res = await createBooking(
      jsonRequest(
        { ...validBooking, serviceId: 'cm0000000000000000000000' },
        { 'x-csrf-token': 'csrf-token' },
      ),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('SERVICE_UNAVAILABLE');
  });

  /**
   * Rate limiting is real and per-user: BOOKING_POLICY allows 10 creations per
   * hour, so the 11th is refused with 429 and a Retry-After header.
   */
  it('rate-limits repeated booking creation for one user', async () => {
    const { createBooking } = await loadHandlers();
    signIn('customer-flood');

    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await createBooking(
        jsonRequest(validBooking, { 'x-csrf-token': 'csrf-token' }),
      );
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);

    const limited = await createBooking(
      jsonRequest(validBooking, { 'x-csrf-token': 'csrf-token' }),
    );
    expect(limited.headers.get('Retry-After')).toBeTruthy();
  });
});

describe('GET /api/bookings', () => {
  it('rejects an unauthenticated list request', async () => {
    const { listBookings } = await loadHandlers();
    const res = await listBookings(new Request(`${ORIGIN}/api/bookings`));
    expect(res.status).toBe(401);
  });

  it('returns only the requesting customer\'s own bookings', async () => {
    const { listBookings } = await loadHandlers();
    signIn('customer-1');
    bookingRows.push(
      { id: 'b-mine', customerId: 'customer-1', reference: 'SERIC-1', status: 'REQUESTED' },
      { id: 'b-theirs', customerId: 'customer-2', reference: 'SERIC-2', status: 'PAID' },
    );

    const res = await listBookings(new Request(`${ORIGIN}/api/bookings`, { headers: { origin: ORIGIN } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].reference).toBe('SERIC-1');
  });
});

describe('GET /api/bookings/:id (ownership isolation)', () => {
  it('rejects an unauthenticated single-booking read', async () => {
    const { getBooking } = await loadHandlers();
    const res = await getBooking(new Request(`${ORIGIN}/api/bookings/b-1`), ctx('b-1'));
    expect(res.status).toBe(401);
  });

  it('returns a booking the customer owns', async () => {
    const { getBooking } = await loadHandlers();
    signIn('customer-1');
    bookingRows.push({
      id: 'b-mine',
      customerId: 'customer-1',
      reference: 'SERIC-1',
      status: 'CONFIRMED',
    });

    const res = await getBooking(new Request(`${ORIGIN}/api/bookings/b-mine`), ctx('b-mine'));
    expect(res.status).toBe(200);
    expect((await res.json()).booking.reference).toBe('SERIC-1');
  });

  it('returns 404 for another customer\'s booking (IDOR)', async () => {
    const { getBooking } = await loadHandlers();
    signIn('customer-1');
    bookingRows.push({
      id: 'b-theirs',
      customerId: 'customer-2',
      reference: 'SERIC-2',
      status: 'PAID',
    });

    const res = await getBooking(new Request(`${ORIGIN}/api/bookings/b-theirs`), ctx('b-theirs'));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('returns the same 404 for a booking that does not exist', async () => {
    const { getBooking } = await loadHandlers();
    signIn('customer-1');
    bookingRows.push({
      id: 'b-theirs',
      customerId: 'customer-2',
      reference: 'SERIC-2',
      status: 'PAID',
    });

    const missing = await getBooking(new Request(`${ORIGIN}/api/bookings/nope`), ctx('nope'));
    const foreign = await getBooking(new Request(`${ORIGIN}/api/bookings/b-theirs`), ctx('b-theirs'));
    // Identical status and body: the endpoint cannot be used to discover which
    // booking ids exist.
    expect(missing.status).toBe(foreign.status);
    expect(await missing.json()).toEqual(await foreign.json());
  });

  it('rejects an invalid booking id', async () => {
    const { getBooking } = await loadHandlers();
    signIn('customer-1');
    const res = await getBooking(
      new Request(`${ORIGIN}/api/bookings/bad-id`),
      ctx('bad-id'),
    );
    expect(res.status).toBe(404);
  });
});
