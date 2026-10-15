/// <reference types="vitest/globals" />

/**
 * ADMIN BOOKINGS LIST TESTS
 *
 * These drive the REAL `GET /api/admin/bookings` handler, so the full read
 * guard chain runs on every call: assertSameOrigin -> requireAdmin -> rate
 * limit -> strict Zod query parse -> `listAllBookings`. Prisma is mocked with
 * a small in-memory booking store.
 */

import { createHash } from 'node:crypto';
import { resetSessions, sessionState, signIn } from './stubs/session-control';
import { resetRateLimit } from '../src/lib/rate-limit';
import { adminBookingQuerySchema } from '../src/lib/validation';
import { findAdminNavItem } from '../src/lib/admin-nav';

vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));
vi.mock('../src/lib/prisma', () => ({ prisma: makePrismaMock() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

const ADMIN_ID = 'cadmin0000000000000000001';
const CUSTOMER_ID = 'ccustomer00000000000000001';
const ORIGIN = 'http://localhost:3000';
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

type BookingRow = {
  id: string;
  reference: string;
  status: string;
  customer: { id: string; name: string };
  service: { id: string; name: string };
};

const bookingRows: BookingRow[] = [];
let lastFindManyArgs: { where?: Record<string, unknown>; skip?: number; take?: number } | null = null;

function seedBooking(row: Partial<BookingRow> & { id: string; reference: string; status: string }) {
  const full: BookingRow = {
    customer: { id: 'ccustomer00000000000000002', name: 'Asha Verma' },
    service: { id: 'cservice00000000000000001', name: 'AC Repair' },
    ...row,
  };
  bookingRows.push(full);
  return full;
}

function applyWhere(rows: BookingRow[], where: Record<string, unknown>): BookingRow[] {
  let out = [...rows];
  if (typeof where.status === 'string') out = out.filter((r) => r.status === where.status);
  const ref = where.reference as { contains?: string } | undefined;
  if (ref?.contains) out = out.filter((r) => r.reference.includes(String(ref.contains)));
  return out;
}


function makePrismaMock() {
  const now = new Date();
  return {
    session: {
      findUnique: async ({ where }: { where?: { tokenHash?: string } } = {}) => {
        const userId = sessionState.currentUserId;
        if (!userId) return null;
        if (where?.tokenHash !== hash(`token-${userId}`)) return null;
        return {
          csrfToken: sessionState.csrfByUserId.get(userId) ?? 'csrf-token',
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
      findMany: async (
        args: { where?: Record<string, unknown>; skip?: number; take?: number } = {},
      ) => {
        lastFindManyArgs = { ...args };
        const filtered = applyWhere(bookingRows, args.where ?? {});
        const skip = args.skip ?? 0;
        const take = args.take ?? filtered.length;
        return filtered.slice(skip, skip + take).map((r) => ({ ...r }));
      },
      count: async (args: { where?: Record<string, unknown> } = {}) =>
        applyWhere(bookingRows, args.where ?? {}).length,
    },
  };
}


async function loadHandler() {
  vi.resetModules();
  const mod = await import('../src/app/api/admin/bookings/route');
  return mod.GET;
}

function get(path: string) {
  return new Request(`${ORIGIN}${path}`, { headers: { origin: ORIGIN } });
}

beforeEach(() => {
  resetSessions();
  resetRateLimit();
  bookingRows.length = 0;
  lastFindManyArgs = null;
});

describe('GET /api/admin/bookings: authorization', () => {
  it('rejects an unauthenticated caller', async () => {
    seedBooking({ id: 'cbooking0000000000000001', reference: 'MOYO-2026-000001', status: 'REQUESTED' });
    const getBookings = await loadHandler();
    const res = await getBookings(get('/api/admin/bookings'));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('rejects a CUSTOMER session', async () => {
    seedBooking({ id: 'cbooking0000000000000001', reference: 'MOYO-2026-000001', status: 'REQUESTED' });
    const getBookings = await loadHandler();
    signIn(CUSTOMER_ID);
    const res = await getBookings(get('/api/admin/bookings'));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('rejects a cross-origin ADMIN read', async () => {
    seedBooking({ id: 'cbooking0000000000000001', reference: 'MOYO-2026-000001', status: 'REQUESTED' });
    const getBookings = await loadHandler();
    signIn(ADMIN_ID);
    const res = await getBookings(
      new Request(`${ORIGIN}/api/admin/bookings`, { headers: { origin: 'https://evil.example' } }),
    );
    expect(res.status).toBe(403);
  });

  it('lets an ADMIN read the queue', async () => {
    seedBooking({ id: 'cbooking0000000000000001', reference: 'MOYO-2026-000001', status: 'REQUESTED' });
    const getBookings = await loadHandler();
    signIn(ADMIN_ID);
    const res = await getBookings(get('/api/admin/bookings'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].reference).toBe('MOYO-2026-000001');
    expect(body.items[0].customer.name).toBe('Asha Verma');
  });
});


describe('GET /api/admin/bookings: filters and pagination', () => {
  it('filters by status with an allowlisted value only', async () => {
    seedBooking({ id: 'cbooking0000000000000001', reference: 'MOYO-2026-000001', status: 'REQUESTED' });
    seedBooking({ id: 'cbooking0000000000000002', reference: 'MOYO-2026-000002', status: 'CONFIRMED' });
    const getBookings = await loadHandler();
    signIn(ADMIN_ID);
    const res = await getBookings(get('/api/admin/bookings?status=CONFIRMED'));
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].status).toBe('CONFIRMED');
    expect(lastFindManyArgs?.where).toMatchObject({ status: 'CONFIRMED' });
  });

  it('searches by reference substring', async () => {
    seedBooking({ id: 'cbooking0000000000000001', reference: 'MOYO-2026-000001', status: 'REQUESTED' });
    seedBooking({ id: 'cbooking0000000000000002', reference: 'MOYO-2026-000002', status: 'REQUESTED' });
    const getBookings = await loadHandler();
    signIn(ADMIN_ID);
    const res = await getBookings(get('/api/admin/bookings?q=000002'));
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].reference).toBe('MOYO-2026-000002');
  });

  it('rejects unknown params, free-form statuses and bad pages', async () => {
    const getBookings = await loadHandler();
    signIn(ADMIN_ID);
    for (const qs of ['?sort=desc', '?status=WHATEVER', '?status=all', '?page=0', '?pageSize=1000']) {
      const res = await getBookings(get(`/api/admin/bookings${qs}`));
      expect(res.status).toBe(422);
    }
  });

  it('pages with bounded skip/take', async () => {
    for (let i = 1; i <= 3; i++) {
      seedBooking({
        id: `cbooking000000000000000${i}`,
        reference: `MOYO-2026-00000${i}`,
        status: 'REQUESTED',
      });
    }
    const getBookings = await loadHandler();
    signIn(ADMIN_ID);
    const res = await getBookings(get('/api/admin/bookings?page=2&pageSize=2'));
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(1);
    expect(lastFindManyArgs?.skip).toBe(2);
    expect(lastFindManyArgs?.take).toBe(2);
  });
});

describe('adminBookingQuerySchema', () => {
  it('applies safe defaults', () => {
    expect(adminBookingQuerySchema.parse({})).toEqual({ status: 'ALL', page: 1, pageSize: 20 });
  });

  it('accepts a canonical status and coerced page values', () => {
    const p = adminBookingQuerySchema.parse({ status: 'TECHNICIAN_ASSIGNED', page: '3', pageSize: '50' });
    expect(p.status).toBe('TECHNICIAN_ASSIGNED');
    expect(p.page).toBe(3);
    expect(p.pageSize).toBe(50);
  });

  it('rejects unknown keys, free-form statuses and bad pages', () => {
    expect(adminBookingQuerySchema.safeParse({ sort: 'desc' }).success).toBe(false);
    expect(adminBookingQuerySchema.safeParse({ status: 'WHATEVER' }).success).toBe(false);
    expect(adminBookingQuerySchema.safeParse({ status: 'all' }).success).toBe(false);
    expect(adminBookingQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(adminBookingQuerySchema.safeParse({ pageSize: 1000 }).success).toBe(false);
    expect(adminBookingQuerySchema.safeParse({ page: 'abc' }).success).toBe(false);
  });
});

describe('admin navigation', () => {
  it('marks Bookings live now that the screen exists', () => {
    expect(findAdminNavItem('/admin/bookings')).toMatchObject({
      href: '/admin/bookings',
      status: 'live',
    });
  });
});
