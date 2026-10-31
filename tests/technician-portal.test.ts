/// <reference types="vitest/globals" />

/**
 * TECHNICIAN PORTAL TESTS
 *
 * The portal has no mutation endpoints in this milestone, so the security
 * surface is authorization and projection:
 *
 *  - the feature switch is the first gate (`PORTAL_DISABLED`);
 *  - role and profile come from the session, never from a parameter;
 *  - every job read is scoped by the session's technician id;
 *  - the job projection contains no invoice, no payment and no customer account
 *    contact;
 *  - a technician session is refused by the admin invoice and assignment routes;
 *  - sign-in is refused while the portal is off or the profile is inactive;
 *  - the one-time activation token is single-use, expiring and portal-gated.
 */

import bcrypt from 'bcryptjs';
import { resetSessions, signIn } from './stubs/session-control';
import { resetRateLimit } from '../src/lib/rate-limit';
import {
  ADMIN_ID,
  BOOKING_ID,
  CSRF,
  CUSTOMER_ID,
  ORIGIN,
  OTHER_BOOKING_ID,
  OTHER_TECH_ID,
  OTHER_TECH_USER_ID,
  TECHNICIAN_ID,
  TECHNICIAN_USER_ID,
  auditRows,
  featureRows,
  jobRows,
  makePrismaMock,
  probe,
  resetTechnicianStore,
  seedJob,
  seedPortalTechnician,
  seedTechnician,
  seedUser,
  technicianRows,
  userRows,
} from './stubs/technician-store';

vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));
vi.mock('../src/lib/prisma', () => ({ prisma: makePrismaMock() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

const PASSWORD = 'Correct-Horse-1!';

function loginRequest(identifier: string, password: string) {
  return new Request(`${ORIGIN}/api/auth/login?next=%2Ftechnician`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ identifier, password }),
  });
}

function activateRequest(body: unknown) {
  return new Request(`${ORIGIN}/api/technician/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(body),
  });
}

function enablePortal() {
  featureRows.length = 0;
  featureRows.push({ id: 'singleton', adminManagementEnabled: true, portalEnabled: true });
}

beforeEach(() => {
  resetSessions();
  resetRateLimit();
  vi.resetModules();
  resetTechnicianStore();
  seedUser({ id: ADMIN_ID, role: 'ADMIN', name: 'Ops Admin' });
  seedUser({ id: CUSTOMER_ID, role: 'CUSTOMER' });
});

describe('requireTechnicianApi', () => {
  it('refuses every caller while the portal is disabled', async () => {
    seedPortalTechnician();
    signIn(TECHNICIAN_USER_ID);

    const { requireTechnicianApi } = await import('../src/lib/technician-access');
    await expect(requireTechnicianApi()).rejects.toMatchObject({ code: 'PORTAL_DISABLED' });
  });

  it('refuses an anonymous caller when the portal is enabled', async () => {
    enablePortal();
    const { requireTechnicianApi } = await import('../src/lib/technician-access');
    await expect(requireTechnicianApi()).rejects.toMatchObject({ status: 401 });
  });

  it('refuses a customer session', async () => {
    enablePortal();
    signIn(CUSTOMER_ID);
    const { requireTechnicianApi } = await import('../src/lib/technician-access');
    await expect(requireTechnicianApi()).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a technician whose profile is inactive', async () => {
    enablePortal();
    seedPortalTechnician({ isActive: false });
    signIn(TECHNICIAN_USER_ID);
    const { requireTechnicianApi } = await import('../src/lib/technician-access');
    await expect(requireTechnicianApi()).rejects.toMatchObject({ status: 403 });
  });

  it('admits an active, linked technician', async () => {
    enablePortal();
    seedPortalTechnician();
    signIn(TECHNICIAN_USER_ID);

    const { requireTechnicianApi } = await import('../src/lib/technician-access');
    const session = await requireTechnicianApi();
    expect(session.technician.id).toBe(TECHNICIAN_ID);
    expect(session.user.role).toBe('TECHNICIAN');
  });
});


describe('technician sign-in', () => {
  function seedCredentialedTechnician() {
    const hash = bcrypt.hashSync(PASSWORD, 12);
    seedUser({
      id: TECHNICIAN_USER_ID,
      role: 'TECHNICIAN',
      email: 'ravi@example.com',
      phone: '9876500001',
      passwordHash: hash,
    });
    seedTechnician({
      id: TECHNICIAN_ID,
      userId: TECHNICIAN_USER_ID,
      displayName: 'Ravi Kumar',
    });
  }

  it('signs an active technician in and lands them on the portal', async () => {
    enablePortal();
    seedCredentialedTechnician();

    const { POST } = await import('../src/app/api/auth/login/route');
    const res = await POST(loginRequest('ravi@example.com', PASSWORD));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { redirectTo: string };
    expect(body.redirectTo).toBe('/technician');
  });

  it('refuses sign-in while the portal is switched off', async () => {
    seedCredentialedTechnician();

    const { POST } = await import('../src/app/api/auth/login/route');
    const res = await POST(loginRequest('ravi@example.com', PASSWORD));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('PORTAL_DISABLED');
  });

  it('refuses sign-in for a technician whose profile is inactive', async () => {
    enablePortal();
    seedCredentialedTechnician();
    // The login is still active; only the roster profile was deactivated. The
    // array imported at the top of this file is the one the Prisma double reads -
    // a fresh `import()` after `vi.resetModules()` would be a different module
    // instance with empty state.
    const technician = technicianRows[0];
    if (technician) technician.isActive = false;

    const { POST } = await import('../src/app/api/auth/login/route');
    const res = await POST(loginRequest('ravi@example.com', PASSWORD));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('ACCOUNT_DISABLED');
  });

  it('does not disclose the portal state to a wrong password', async () => {
    seedCredentialedTechnician();
    const { POST } = await import('../src/app/api/auth/login/route');
    const res = await POST(loginRequest('ravi@example.com', 'Wrong-Password-1!'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('job ownership and projection', () => {
  it('returns only jobs assigned to the signed-in technician', async () => {
    seedPortalTechnician();
    seedPortalTechnician({ userId: OTHER_TECH_USER_ID, technicianId: OTHER_TECH_ID });
    seedJob({ id: BOOKING_ID, status: 'TECHNICIAN_ASSIGNED', technicianId: TECHNICIAN_ID });
    seedJob({ id: OTHER_BOOKING_ID, status: 'SERVICE_IN_PROGRESS', technicianId: OTHER_TECH_ID });

    const { listTechnicianJobs, getTechnicianJob } = await import('../src/lib/technician-access');

    const list = await listTechnicianJobs(TECHNICIAN_ID, { page: 1 });
    expect(list.items.map((job) => job.id)).toEqual([BOOKING_ID]);

    expect(await getTechnicianJob(TECHNICIAN_ID, BOOKING_ID)).not.toBeNull();
    // Another technician's job is not found, exactly like a nonexistent one.
    expect(await getTechnicianJob(TECHNICIAN_ID, OTHER_BOOKING_ID)).toBeNull();
  });

  it('projects no invoice, no payment and no customer account contact', async () => {
    seedPortalTechnician();
    seedJob({ id: BOOKING_ID, status: 'TECHNICIAN_ASSIGNED' });

    const { getTechnicianJob } = await import('../src/lib/technician-access');
    await getTechnicianJob(TECHNICIAN_ID, BOOKING_ID);

    const select = probe.lastBookingSelect ?? {};
    expect(Object.keys(select)).not.toContain('invoice');
    expect(Object.keys(select)).not.toContain('payments');
    expect(select.customer).toEqual({ select: { name: true } });

    const projection = JSON.stringify(select);
    expect(projection).not.toContain('email');
    expect(projection).not.toContain('totalPaise');
    expect(projection).not.toContain('quotedPaise');
  });
});


describe('function-level authorization', () => {
  it('refuses a technician session on the admin invoice endpoint', async () => {
    enablePortal();
    seedPortalTechnician();
    signIn(TECHNICIAN_USER_ID);

    const { POST } = await import('../src/app/api/admin/bookings/[id]/invoice/route');
    const res = await POST(
      new Request(`${ORIGIN}/api/admin/bookings/${BOOKING_ID}/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: ORIGIN, 'x-csrf-token': CSRF },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    );

    expect(res.status).toBe(403);
  });

  it('refuses a technician session on the assignment endpoint', async () => {
    enablePortal();
    seedPortalTechnician();
    signIn(TECHNICIAN_USER_ID);

    const { POST } = await import('../src/app/api/admin/bookings/[id]/assign-technician/route');
    const res = await POST(
      new Request(`${ORIGIN}/api/admin/bookings/${BOOKING_ID}/assign-technician`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: ORIGIN, 'x-csrf-token': CSRF },
        body: JSON.stringify({ technicianId: TECHNICIAN_ID }),
      }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    );

    expect(res.status).toBe(403);
  });
});

describe('POST /api/technician/activate', () => {
  const TOKEN = 'a'.repeat(43);

  function seedInvitedTechnician(options?: { expiresAt?: Date }) {
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    seedUser({
      id: TECHNICIAN_USER_ID,
      role: 'TECHNICIAN',
      email: 'ravi@example.com',
      activationTokenHash: createHash('sha256').update(TOKEN, 'utf8').digest('hex'),
      activationExpiresAt: options?.expiresAt ?? new Date(Date.now() + 86_400_000),
    });
    seedTechnician({ id: TECHNICIAN_ID, userId: TECHNICIAN_USER_ID, displayName: 'Ravi Kumar' });
    return TECHNICIAN_USER_ID;
  }

  it('sets the password, clears the token and audits the activation', async () => {
    enablePortal();
    const userId = seedInvitedTechnician();

    const { POST } = await import('../src/app/api/technician/activate/route');
    const res = await POST(
      activateRequest({ token: TOKEN, password: PASSWORD, confirmPassword: PASSWORD }),
    );

    expect(res.status).toBe(200);
    const account = userRows.find((u) => u.id === userId);
    expect(account?.activationTokenHash).toBeNull();
    expect(account?.activationExpiresAt).toBeNull();
    expect(account?.passwordHash).not.toBe('unusable');
    expect(await bcrypt.compare(PASSWORD, account?.passwordHash ?? '')).toBe(true);

    expect(auditRows.map((a) => a.action)).toContain('TECHNICIAN_ACCOUNT_ACTIVATED');
    const body = (await res.json()) as { redirectTo: string };
    expect(body.redirectTo).toBe('/technician/login?activated=1');
  });

  it('refuses a reused token', async () => {
    enablePortal();
    seedInvitedTechnician();

    const { POST } = await import('../src/app/api/technician/activate/route');
    const first = await POST(
      activateRequest({ token: TOKEN, password: PASSWORD, confirmPassword: PASSWORD }),
    );
    expect(first.status).toBe(200);

    const second = await POST(
      activateRequest({ token: TOKEN, password: PASSWORD, confirmPassword: PASSWORD }),
    );
    expect(second.status).toBe(400);
  });

  it('refuses an expired invitation', async () => {
    enablePortal();
    seedInvitedTechnician({ expiresAt: new Date(Date.now() - 1000) });

    const { POST } = await import('../src/app/api/technician/activate/route');
    const res = await POST(
      activateRequest({ token: TOKEN, password: PASSWORD, confirmPassword: PASSWORD }),
    );
    expect(res.status).toBe(400);
  });

  it('refuses activation while the portal is off', async () => {
    seedInvitedTechnician();

    const { POST } = await import('../src/app/api/technician/activate/route');
    const res = await POST(
      activateRequest({ token: TOKEN, password: PASSWORD, confirmPassword: PASSWORD }),
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('PORTAL_DISABLED');
  });

  it('rejects a weak password with field-level detail', async () => {
    enablePortal();
    seedInvitedTechnician();

    const { POST } = await import('../src/app/api/technician/activate/route');
    const res = await POST(
      activateRequest({ token: TOKEN, password: 'short', confirmPassword: 'short' }),
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { fields?: Record<string, string> } };
    expect(body.error?.fields).toHaveProperty('password');
  });
});
