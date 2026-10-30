/// <reference types="vitest/globals" />

/**
 * ADMIN BOOKING DISPATCH TESTS - CONFIRMATION AND TECHNICIAN ASSIGNMENT
 *
 * These drive the REAL mutation handlers, so the full guard chain runs on every
 * call: assertSameOrigin -> requireAdmin -> assertCsrf -> rate limit -> strict
 * Zod body -> booking state machine -> conditional update -> status event ->
 * audit. Prisma is a small in-memory store (tests/stubs/booking-store.ts), so
 * the assertions are about what the server actually wrote.
 *
 * What is pinned here:
 *  - confirmation moves REQUESTED -> CONFIRMED and appends a status event,
 *  - assignment moves CONFIRMED -> TECHNICIAN_ASSIGNED for an ACTIVE technician,
 *  - an inactive technician is refused and changes nothing,
 *  - invalid state transitions stay blocked and write nothing,
 *  - a repeated mutation is a 409, never a silent overwrite,
 *  - a CUSTOMER session can drive neither action,
 *  - the CSRF token is required.
 */

import { resetSessions, signIn } from './stubs/session-control';
import { resetRateLimit } from '../src/lib/rate-limit';
import {
  ADMIN_ID,
  BOOKING_ID,
  CSRF,
  CUSTOMER_ID,
  ORIGIN,
  TECHNICIAN_ID,
  auditRows,
  bookingRows,
  eventRows,
  makePrismaMock,
  resetBookingStore,
  seedBooking,
  technicianRows,
} from './stubs/booking-store';

vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));
vi.mock('../src/lib/prisma', () => ({ prisma: makePrismaMock() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function loadConfirm() {
  return (await import('../src/app/api/admin/bookings/[id]/confirm/route')).POST;
}

async function loadAssign() {
  return (await import('../src/app/api/admin/bookings/[id]/assign-technician/route')).POST;
}

beforeEach(() => {
  resetSessions();
  resetRateLimit();
  vi.resetModules();
  resetBookingStore();
});

describe('POST /api/admin/bookings/:id/confirm', () => {
  it('moves REQUESTED to CONFIRMED and appends a status event', async () => {
    seedBooking({ id: BOOKING_ID, reference: 'SERIC-2026-000001', status: 'REQUESTED' });
    signIn(ADMIN_ID);
    const confirm = await loadConfirm();
    const res = await confirm(
      post(`/api/admin/bookings/${BOOKING_ID}/confirm`, {}, { 'x-csrf-token': CSRF }),
      ctx(BOOKING_ID),
    );
    expect(res.status).toBe(200);
    expect(bookingRows[0]?.status).toBe('CONFIRMED');
    expect(eventRows).toEqual([
      { bookingId: BOOKING_ID, from: 'REQUESTED', to: 'CONFIRMED', actorRole: 'ADMIN' },
    ]);
    expect(auditRows.map((a) => a.action)).toContain('BOOKING_CONFIRMED');
  });

  it('requires the CSRF token', async () => {
    seedBooking({ id: BOOKING_ID, reference: 'SERIC-2026-000001', status: 'REQUESTED' });
    signIn(ADMIN_ID);
    const confirm = await loadConfirm();
    const res = await confirm(
      post(`/api/admin/bookings/${BOOKING_ID}/confirm`, {}),
      ctx(BOOKING_ID),
    );
    expect(res.status).toBe(403);
    expect(bookingRows[0]?.status).toBe('REQUESTED');
    expect(eventRows).toHaveLength(0);
  });

  it('blocks confirming a booking that is already CONFIRMED', async () => {
    seedBooking({ id: BOOKING_ID, reference: 'SERIC-2026-000001', status: 'CONFIRMED' });
    signIn(ADMIN_ID);
    const confirm = await loadConfirm();
    const res = await confirm(
      post(`/api/admin/bookings/${BOOKING_ID}/confirm`, {}, { 'x-csrf-token': CSRF }),
      ctx(BOOKING_ID),
    );
    expect(res.status).toBe(409);
    expect(bookingRows[0]?.status).toBe('CONFIRMED');
    expect(eventRows).toHaveLength(0);
    // The refused attempt is itself audited.
    expect(auditRows.map((a) => a.action)).toContain('ACCESS_DENIED');
  });

  it('blocks confirming a terminal (CLOSED) booking', async () => {
    seedBooking({ id: BOOKING_ID, reference: 'SERIC-2026-000001', status: 'CLOSED' });
    signIn(ADMIN_ID);
    const confirm = await loadConfirm();
    const res = await confirm(
      post(`/api/admin/bookings/${BOOKING_ID}/confirm`, {}, { 'x-csrf-token': CSRF }),
      ctx(BOOKING_ID),
    );
    expect(res.status).toBe(409);
    expect(bookingRows[0]?.status).toBe('CLOSED');
  });

  it('refuses a CUSTOMER driver', async () => {
    seedBooking({ id: BOOKING_ID, reference: 'SERIC-2026-000001', status: 'REQUESTED' });
    signIn(CUSTOMER_ID);
    const confirm = await loadConfirm();
    const res = await confirm(
      post(`/api/admin/bookings/${BOOKING_ID}/confirm`, {}, { 'x-csrf-token': CSRF }),
      ctx(BOOKING_ID),
    );
    expect(res.status).toBe(403);
    expect(bookingRows[0]?.status).toBe('REQUESTED');
  });
});

describe('POST /api/admin/bookings/:id/assign-technician', () => {
  it('assigns an active technician to a CONFIRMED booking', async () => {
    seedBooking({ id: BOOKING_ID, reference: 'SERIC-2026-000001', status: 'CONFIRMED' });
    technicianRows.push({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar', isActive: true });
    signIn(ADMIN_ID);
    const assign = await loadAssign();
    const res = await assign(
      post(
        `/api/admin/bookings/${BOOKING_ID}/assign-technician`,
        { technicianId: TECHNICIAN_ID },
        { 'x-csrf-token': CSRF },
      ),
      ctx(BOOKING_ID),
    );
    expect(res.status).toBe(200);
    expect(bookingRows[0]?.status).toBe('TECHNICIAN_ASSIGNED');
    expect(bookingRows[0]?.technicianId).toBe(TECHNICIAN_ID);
    expect(eventRows).toEqual([
      { bookingId: BOOKING_ID, from: 'CONFIRMED', to: 'TECHNICIAN_ASSIGNED', actorRole: 'ADMIN' },
    ]);
    expect(auditRows.map((a) => a.action)).toContain('TECHNICIAN_ASSIGNED');
  });

  it('rejects an inactive technician without changing the booking', async () => {
    seedBooking({ id: BOOKING_ID, reference: 'SERIC-2026-000001', status: 'CONFIRMED' });
    technicianRows.push({ id: TECHNICIAN_ID, displayName: 'Retired Tech', isActive: false });
    signIn(ADMIN_ID);
    const assign = await loadAssign();
    const res = await assign(
      post(
        `/api/admin/bookings/${BOOKING_ID}/assign-technician`,
        { technicianId: TECHNICIAN_ID },
        { 'x-csrf-token': CSRF },
      ),
      ctx(BOOKING_ID),
    );
    expect(res.status).toBe(422);
    expect(bookingRows[0]?.status).toBe('CONFIRMED');
    expect(bookingRows[0]?.technicianId).toBeNull();
    expect(eventRows).toHaveLength(0);
  });

  it('blocks assignment on a booking that is still REQUESTED', async () => {
    seedBooking({ id: BOOKING_ID, reference: 'SERIC-2026-000001', status: 'REQUESTED' });
    technicianRows.push({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar', isActive: true });
    signIn(ADMIN_ID);
    const assign = await loadAssign();
    const res = await assign(
      post(
        `/api/admin/bookings/${BOOKING_ID}/assign-technician`,
        { technicianId: TECHNICIAN_ID },
        { 'x-csrf-token': CSRF },
      ),
      ctx(BOOKING_ID),
    );
    expect(res.status).toBe(409);
    expect(bookingRows[0]?.status).toBe('REQUESTED');
    expect(bookingRows[0]?.technicianId).toBeNull();
  });

  it('reports a repeated assignment as a conflict rather than overwriting it', async () => {
    seedBooking({ id: BOOKING_ID, reference: 'SERIC-2026-000001', status: 'CONFIRMED' });
    technicianRows.push({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar', isActive: true });
    signIn(ADMIN_ID);
    const assign = await loadAssign();
    const first = await assign(
      post(
        `/api/admin/bookings/${BOOKING_ID}/assign-technician`,
        { technicianId: TECHNICIAN_ID },
        { 'x-csrf-token': CSRF },
      ),
      ctx(BOOKING_ID),
    );
    expect(first.status).toBe(200);

    // The booking is no longer CONFIRMED, so the second attempt is refused.
    const second = await assign(
      post(
        `/api/admin/bookings/${BOOKING_ID}/assign-technician`,
        { technicianId: TECHNICIAN_ID },
        { 'x-csrf-token': CSRF },
      ),
      ctx(BOOKING_ID),
    );
    expect(second.status).toBe(409);
    expect(eventRows).toHaveLength(1);
  });

  it('refuses a CUSTOMER driver', async () => {
    seedBooking({ id: BOOKING_ID, reference: 'SERIC-2026-000001', status: 'CONFIRMED' });
    technicianRows.push({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar', isActive: true });
    signIn(CUSTOMER_ID);
    const assign = await loadAssign();
    const res = await assign(
      post(
        `/api/admin/bookings/${BOOKING_ID}/assign-technician`,
        { technicianId: TECHNICIAN_ID },
        { 'x-csrf-token': CSRF },
      ),
      ctx(BOOKING_ID),
    );
    expect(res.status).toBe(403);
    expect(bookingRows[0]?.technicianId).toBeNull();
  });
});
