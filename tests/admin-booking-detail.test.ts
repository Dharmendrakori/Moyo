/// <reference types="vitest/globals" />

/**
 * ADMIN BOOKING DETAIL TESTS
 *
 * These drive the REAL `GET /api/admin/bookings/:id` handler, so the full guard
 * chain runs on every call: assertSameOrigin -> requireAdmin -> rate limit ->
 * id validation -> ownership-scoped read. Prisma is a small in-memory store
 * (tests/stubs/booking-store.ts).
 *
 * What is pinned here:
 *  - an unauthenticated caller and a CUSTOMER session are both refused,
 *  - an ADMIN receives the persisted record and its status log,
 *  - an unknown id is a 404,
 *  - a malformed id is a 404 that never reaches the database.
 */

import { resetSessions, signIn } from './stubs/session-control';
import { resetRateLimit } from '../src/lib/rate-limit';
import {
  ADMIN_ID,
  BOOKING_ID,
  CUSTOMER_ID,
  ORIGIN,
  bookingRows,
  eventRows,
  makePrismaMock,
  probe,
  resetBookingStore,
  seedBooking,
} from './stubs/booking-store';

vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));
vi.mock('../src/lib/prisma', () => ({ prisma: makePrismaMock() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

function get(path: string) {
  return new Request(`${ORIGIN}${path}`, { headers: { origin: ORIGIN } });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function loadRead() {
  return (await import('../src/app/api/admin/bookings/[id]/route')).GET;
}

beforeEach(() => {
  resetSessions();
  resetRateLimit();
  vi.resetModules();
  resetBookingStore();
});

describe('GET /api/admin/bookings/:id', () => {
  it('rejects an unauthenticated caller', async () => {
    seedBooking({ id: BOOKING_ID, reference: 'SERIC-2026-000001', status: 'REQUESTED' });
    const read = await loadRead();
    const res = await read(get(`/api/admin/bookings/${BOOKING_ID}`), ctx(BOOKING_ID));
    expect(res.status).toBe(401);
  });

  it('rejects a CUSTOMER session (no detail leak)', async () => {
    seedBooking({ id: BOOKING_ID, reference: 'SERIC-2026-000001', status: 'REQUESTED' });
    signIn(CUSTOMER_ID);
    const read = await loadRead();
    const res = await read(get(`/api/admin/bookings/${BOOKING_ID}`), ctx(BOOKING_ID));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('returns the persisted record and its status log to an ADMIN', async () => {
    seedBooking({ id: BOOKING_ID, reference: 'SERIC-2026-000001', status: 'CONFIRMED' });
    eventRows.push({ bookingId: BOOKING_ID, from: 'REQUESTED', to: 'CONFIRMED', actorRole: 'ADMIN' });
    signIn(ADMIN_ID);
    const read = await loadRead();
    const res = await read(get(`/api/admin/bookings/${BOOKING_ID}`), ctx(BOOKING_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.booking.reference).toBe('SERIC-2026-000001');
    expect(body.booking.status).toBe('CONFIRMED');
    expect(body.booking.contactName).toBe('Asha Verma');
    expect(body.booking.statusEvents).toHaveLength(1);
    expect(body.booking.statusEvents[0]).toMatchObject({ from: 'REQUESTED', to: 'CONFIRMED' });
    // No credential material is projected at all.
    expect(body.booking.passwordHash).toBeUndefined();
  });

  it('projects no customer account email or phone for the admin detail page', async () => {
    // Data minimisation, asserted on the query the page actually issues: the
    // booking's own contactName/contactPhone cover dispatch, so the customer
    // account's email and phone must never be read for this screen.
    seedBooking({ id: BOOKING_ID, reference: 'SERIC-2026-000001', status: 'REQUESTED' });
    const { getAdminBookingDetail } = await import('../src/lib/customer-bookings');
    await getAdminBookingDetail(BOOKING_ID);

    const selected = probe.lastSelect ?? {};
    const customer = selected.customer as { select?: Record<string, unknown> } | undefined;
    expect(customer?.select).toBeDefined();
    expect(customer?.select).not.toHaveProperty('email');
    expect(customer?.select).not.toHaveProperty('phone');
    expect(customer?.select).toHaveProperty('name');
    // Dispatch contact comes from the booking itself, not the account.
    expect(selected).toHaveProperty('contactName');
    expect(selected).toHaveProperty('contactPhone');
    // Credentials are never selected, in either shape.
    expect(selected).not.toHaveProperty('passwordHash');
  });

  it('returns 404 for an unknown booking id', async () => {
    signIn(ADMIN_ID);
    const read = await loadRead();
    const res = await read(
      get('/api/admin/bookings/cbooking0000000000009999'),
      ctx('cbooking0000000000009999'),
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for a malformed id without reaching the database', async () => {
    signIn(ADMIN_ID);
    const read = await loadRead();
    const res = await read(get('/api/admin/bookings/not-an-id'), ctx('not-an-id'));
    expect(res.status).toBe(404);
    expect(probe.lastSelect).toBeNull();
    expect(bookingRows).toHaveLength(0);
  });
});
