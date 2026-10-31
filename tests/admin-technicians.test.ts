/// <reference types="vitest/globals" />

/**
 * ADMIN TECHNICIAN MANAGEMENT TESTS
 *
 * Drives the real route handlers, so every assertion is about what the server
 * actually wrote: guard chain, feature switch, strict body, provider resolution,
 * atomic creation, account provisioning, audit.
 *
 * What is pinned here:
 *  - anonymous 401 and non-admin 403 on every management endpoint;
 *  - CSRF is required for a mutation;
 *  - a profile can be created WITHOUT the portal (no login is created);
 *  - with the portal ON, a TECHNICIAN login is provisioned atomically with an
 *    unusable password and a one-time activation path returned exactly once;
 *  - duplicate profiles and duplicate login identities are refused;
 *  - `role`, `userId`, `providerId` and `passwordHash` in a body are rejected;
 *  - deactivation disables the linked login and revokes its sessions;
 *  - with management switched off the write APIs refuse, while the dispatch read
 *    endpoint keeps working.
 */

import { resetSessions, signIn } from './stubs/session-control';
import { resetRateLimit } from '../src/lib/rate-limit';
import {
  ADMIN_ID,
  CSRF,
  CUSTOMER_ID,
  ORIGIN,
  auditRows,
  featureRows,
  makePrismaMock,
  resetTechnicianStore,
  sessionRevocations,
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

const TECHNICIAN_ID = 'ctechnician00000000000001';

function req(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, csrf?: string) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      origin: ORIGIN,
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function loadCreate() {
  return (await import('../src/app/api/admin/technicians/route')).POST;
}
async function loadUpdate() {
  return (await import('../src/app/api/admin/technicians/[id]/route')).PATCH;
}
async function loadAccount() {
  return (await import('../src/app/api/admin/technicians/[id]/account/route')).POST;
}
async function loadList() {
  return (await import('../src/app/api/admin/technicians/route')).GET;
}

beforeEach(() => {
  resetSessions();
  resetRateLimit();
  vi.resetModules();
  resetTechnicianStore();
  seedUser({ id: ADMIN_ID, role: 'ADMIN', name: 'Ops Admin' });
  seedUser({ id: CUSTOMER_ID, role: 'CUSTOMER' });
});

describe('authorization', () => {
  it('rejects an anonymous caller on creation', async () => {
    const POST = await loadCreate();
    const res = await POST(req('POST', '/api/admin/technicians', { displayName: 'Ravi' }));
    expect(res.status).toBe(401);
    expect(technicianRows).toHaveLength(0);
  });

  it('rejects a signed-in customer on creation, update and provisioning', async () => {
    signIn(CUSTOMER_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar' });

    const POST = await loadCreate();
    const PATCH = await loadUpdate();
    const ACCOUNT = await loadAccount();

    expect(
      (await POST(req('POST', '/api/admin/technicians', { displayName: 'X' }, CSRF))).status,
    ).toBe(403);
    expect(
      (
        await PATCH(
          req('PATCH', `/api/admin/technicians/${TECHNICIAN_ID}`, { isActive: false }, CSRF),
          ctx(TECHNICIAN_ID),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await ACCOUNT(
          req('POST', `/api/admin/technicians/${TECHNICIAN_ID}/account`, {}, CSRF),
          ctx(TECHNICIAN_ID),
        )
      ).status,
    ).toBe(403);

    expect(technicianRows[0]?.isActive).toBe(true);
    expect(userRows).toHaveLength(2);
  });

  it('requires the CSRF token on creation', async () => {
    signIn(ADMIN_ID);
    const POST = await loadCreate();
    const res = await POST(req('POST', '/api/admin/technicians', { displayName: 'Ravi Kumar' }));
    expect(res.status).toBe(403);
    expect(technicianRows).toHaveLength(0);
  });
});


describe('POST /api/admin/technicians', () => {
  it('creates a roster profile with no login while the portal is off', async () => {
    signIn(ADMIN_ID);
    const POST = await loadCreate();
    const res = await POST(
      req(
        'POST',
        '/api/admin/technicians',
        { displayName: 'Ravi Kumar', phone: '9876500001', isAvailable: true },
        CSRF,
      ),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      technician: { id: string; account: unknown; isAvailable: boolean };
      activationPath: string | null;
    };
    expect(body.activationPath).toBeNull();
    expect(body.technician.account).toBeNull();
    expect(body.technician.isAvailable).toBe(true);

    expect(userRows).toHaveLength(2); // admin + customer seeds only
    expect(auditRows.map((a) => a.action)).toContain('TECHNICIAN_CREATED');
  });

  it('provisions a linked login with an unusable password when the portal is on', async () => {
    signIn(ADMIN_ID);
    featureRows.push({ id: 'singleton', adminManagementEnabled: true, portalEnabled: true });

    const POST = await loadCreate();
    const res = await POST(
      req(
        'POST',
        '/api/admin/technicians',
        {
          displayName: 'Ravi Kumar',
          phone: '9876500001',
          isAvailable: true,
          accountEmail: 'ravi@example.com',
          accountPhone: '9876500001',
        },
        CSRF,
      ),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      technician: { account: { email: string; activationPending: boolean } | null };
      activationPath: string | null;
    };

    expect(body.activationPath).toMatch(/^\/technician\/activate\/[A-Za-z0-9_-]{20,}$/);
    expect(body.technician.account?.email).toBe('ravi@example.com');
    expect(body.technician.account?.activationPending).toBe(true);

    const account = userRows.find((u) => u.email === 'ravi@example.com');
    expect(account?.role).toBe('TECHNICIAN');
    expect(account?.activationTokenHash).toBeTruthy();
    expect(account?.passwordHash).not.toBe('9876500001');

    // The response carries the path once but NEVER credential material.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain(account?.activationTokenHash ?? 'IMPOSSIBLE');
    expect(auditRows.map((a) => a.action)).toEqual(
      expect.arrayContaining(['TECHNICIAN_CREATED', 'TECHNICIAN_ACCOUNT_PROVISIONED']),
    );
  });

  it('refuses a portal account without a login identity', async () => {
    signIn(ADMIN_ID);
    featureRows.push({ id: 'singleton', adminManagementEnabled: true, portalEnabled: true });

    const POST = await loadCreate();
    const res = await POST(
      req('POST', '/api/admin/technicians', { displayName: 'Ravi Kumar' }, CSRF),
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('ACCOUNT_REQUIRED');
    expect(technicianRows).toHaveLength(0);
  });

  it('refuses a duplicate profile for the same provider', async () => {
    signIn(ADMIN_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar' });

    const POST = await loadCreate();
    const res = await POST(
      req('POST', '/api/admin/technicians', { displayName: 'Ravi Kumar' }, CSRF),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('DUPLICATE_TECHNICIAN');
    expect(technicianRows).toHaveLength(1);
  });

  it('refuses a login identity that already belongs to an account', async () => {
    signIn(ADMIN_ID);
    featureRows.push({ id: 'singleton', adminManagementEnabled: true, portalEnabled: true });
    seedUser({ id: 'cexisting0000000000000001', role: 'CUSTOMER', email: 'taken@example.com' });

    const POST = await loadCreate();
    const res = await POST(
      req(
        'POST',
        '/api/admin/technicians',
        {
          displayName: 'Ravi Kumar',
          accountEmail: 'taken@example.com',
          accountPhone: '9876500001',
        },
        CSRF,
      ),
    );

    expect(res.status).toBe(409);
    expect(technicianRows).toHaveLength(0);
  });

  it.each([
    ['role', { role: 'ADMIN' }],
    ['userId', { userId: 'cadmin0000000000000000001' }],
    ['providerId', { providerId: 'cprovider0000000000000001' }],
    ['passwordHash', { passwordHash: '$2a$12$attackerchosen' }],
    ['ratingSum', { ratingSum: 500 }],
  ])('rejects a body that tries to set %s', async (_label, extra) => {
    signIn(ADMIN_ID);
    const POST = await loadCreate();
    const res = await POST(
      req('POST', '/api/admin/technicians', { displayName: 'Ravi Kumar', ...extra }, CSRF),
    );

    expect(res.status).toBe(422);
    expect(technicianRows).toHaveLength(0);
  });
});

describe('PATCH /api/admin/technicians/[id]', () => {
  it('updates roster details and audits the change', async () => {
    signIn(ADMIN_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar' });

    const PATCH = await loadUpdate();
    const res = await PATCH(
      req('PATCH', `/api/admin/technicians/${TECHNICIAN_ID}`, { headline: 'AC specialist' }, CSRF),
      ctx(TECHNICIAN_ID),
    );

    expect(res.status).toBe(200);
    expect(technicianRows[0]?.headline).toBe('AC specialist');
    expect(auditRows.map((a) => a.action)).toContain('TECHNICIAN_UPDATED');
  });

  it('records availability as its own event', async () => {
    signIn(ADMIN_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar', isAvailable: true });

    const PATCH = await loadUpdate();
    const res = await PATCH(
      req('PATCH', `/api/admin/technicians/${TECHNICIAN_ID}`, { isAvailable: false }, CSRF),
      ctx(TECHNICIAN_ID),
    );

    expect(res.status).toBe(200);
    expect(technicianRows[0]?.isAvailable).toBe(false);
    expect(auditRows.map((a) => a.action)).toContain('TECHNICIAN_AVAILABILITY_CHANGED');
  });

  it('deactivates the profile, disables the login and revokes its sessions', async () => {
    signIn(ADMIN_ID);
    seedUser({ id: 'ctechuser0000000000000001', role: 'TECHNICIAN' });
    seedTechnician({
      id: TECHNICIAN_ID,
      displayName: 'Ravi Kumar',
      userId: 'ctechuser0000000000000001',
    });

    const PATCH = await loadUpdate();
    const res = await PATCH(
      req('PATCH', `/api/admin/technicians/${TECHNICIAN_ID}`, { isActive: false }, CSRF),
      ctx(TECHNICIAN_ID),
    );

    expect(res.status).toBe(200);
    expect(technicianRows[0]?.isActive).toBe(false);
    expect(userRows.find((u) => u.id === 'ctechuser0000000000000001')?.isActive).toBe(false);
    expect(sessionRevocations).toContainEqual({ userId: 'ctechuser0000000000000001' });

    const actions = auditRows.map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'TECHNICIAN_UPDATED',
        'TECHNICIAN_STATUS_CHANGED',
        'TECHNICIAN_ACCOUNT_DISABLED',
      ]),
    );
  });

  it('rejects a body that would repoint the profile or its account', async () => {
    signIn(ADMIN_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar' });

    const PATCH = await loadUpdate();
    for (const extra of [
      { userId: 'cadmin0000000000000000001' },
      { providerId: 'cotherprovider00000000001' },
      { role: 'ADMIN' },
    ]) {
      const res = await PATCH(
        req('PATCH', `/api/admin/technicians/${TECHNICIAN_ID}`, extra, CSRF),
        ctx(TECHNICIAN_ID),
      );
      expect(res.status).toBe(422);
    }
    expect(technicianRows[0]?.userId).toBeNull();
  });

  it('returns 404 for an unknown technician', async () => {
    signIn(ADMIN_ID);
    const PATCH = await loadUpdate();
    const res = await PATCH(
      req('PATCH', `/api/admin/technicians/${TECHNICIAN_ID}`, { headline: 'x' }, CSRF),
      ctx(TECHNICIAN_ID),
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/technicians/[id]/account', () => {
  it('provisions a login for an existing profile', async () => {
    signIn(ADMIN_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar' });

    const ACCOUNT = await loadAccount();
    const res = await ACCOUNT(
      req(
        'POST',
        `/api/admin/technicians/${TECHNICIAN_ID}/account`,
        { email: 'ravi@example.com', phone: '9876500001' },
        CSRF,
      ),
      ctx(TECHNICIAN_ID),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { activationPath: string };
    expect(body.activationPath).toMatch(/^\/technician\/activate\//);
    expect(technicianRows[0]?.userId).toBeTruthy();
    expect(auditRows.map((a) => a.action)).toContain('TECHNICIAN_ACCOUNT_PROVISIONED');
  });

  it('re-issues an invitation that has not been activated', async () => {
    signIn(ADMIN_ID);
    seedUser({
      id: 'ctechuser0000000000000001',
      role: 'TECHNICIAN',
      activationExpiresAt: new Date(Date.now() + 86_400_000),
    });
    seedTechnician({
      id: TECHNICIAN_ID,
      displayName: 'Ravi Kumar',
      userId: 'ctechuser0000000000000001',
    });

    const ACCOUNT = await loadAccount();
    const res = await ACCOUNT(
      req('POST', `/api/admin/technicians/${TECHNICIAN_ID}/account`, {}, CSRF),
      ctx(TECHNICIAN_ID),
    );

    expect(res.status).toBe(201);
    // No second account was created - only the token was rotated.
    expect(userRows.filter((u) => u.role === 'TECHNICIAN')).toHaveLength(1);
  });

  it('refuses to reset an account that has already been activated', async () => {
    signIn(ADMIN_ID);
    seedUser({ id: 'ctechuser0000000000000001', role: 'TECHNICIAN', activationExpiresAt: null });
    seedTechnician({
      id: TECHNICIAN_ID,
      displayName: 'Ravi Kumar',
      userId: 'ctechuser0000000000000001',
    });

    const ACCOUNT = await loadAccount();
    const res = await ACCOUNT(
      req('POST', `/api/admin/technicians/${TECHNICIAN_ID}/account`, {}, CSRF),
      ctx(TECHNICIAN_ID),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('ACCOUNT_EXISTS');
  });
});

describe('feature switch enforcement', () => {
  it('refuses management writes when management is off, but keeps dispatch reads working', async () => {
    signIn(ADMIN_ID);
    featureRows.push({ id: 'singleton', adminManagementEnabled: false, portalEnabled: false });

    const POST = await loadCreate();
    const PATCH = await loadUpdate();
    const GET = await loadList();

    const create = await POST(
      req('POST', '/api/admin/technicians', { displayName: 'Ravi Kumar' }, CSRF),
    );
    expect(create.status).toBe(403);
    const body = (await create.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('ADMIN_MANAGEMENT_DISABLED');

    const patch = await PATCH(
      req('PATCH', `/api/admin/technicians/${TECHNICIAN_ID}`, { isActive: false }, CSRF),
      ctx(TECHNICIAN_ID),
    );
    expect(patch.status).toBe(403);

    // Dispatch must still be able to list technicians for assignment.
    const list = await GET(req('GET', '/api/admin/technicians'));
    expect(list.status).toBe(200);
  });

  it('lists technicians to an administrator without credential material', async () => {
    signIn(ADMIN_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar', isAvailable: true });

    const GET = await loadList();
    const res = await GET(req('GET', '/api/admin/technicians'));
    expect(res.status).toBe(200);

    const raw = JSON.stringify(await res.json());
    expect(raw).toContain('Ravi Kumar');
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('activationTokenHash');
  });
});
