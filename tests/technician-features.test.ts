/// <reference types="vitest/globals" />

/**
 * TECHNICIAN FEATURE CONFIGURATION TESTS
 *
 * Drives the real configuration module and the real admin route handlers, so the
 * full guard chain runs on every call: assertSameOrigin -> requireAdmin ->
 * assertCsrf -> rate limit -> strict Zod -> typed upsert -> audit.
 *
 * What is pinned here:
 *  - the documented defaults (admin ON, portal OFF) apply when no row exists;
 *  - a stored row is honoured, and all four combinations resolve correctly;
 *  - an UNREADABLE configuration falls back to the defaults, so a database
 *    failure can never switch technician authentication on;
 *  - non-admin, missing-CSRF and unknown-key mutations are refused;
 *  - a change is audited with previous and new values;
 *  - switching the portal off revokes live technician sessions;
 *  - switching management off keeps every technician record.
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
  seedPortalTechnician,
  seedUser,
  storeFlags,
  technicianRows,
} from './stubs/technician-store';

vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));
vi.mock('../src/lib/prisma', () => ({ prisma: makePrismaMock() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

function request(
  method: 'GET' | 'PATCH',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', origin: ORIGIN, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function loadConfig() {
  return import('../src/lib/technician-features');
}

async function loadRoute() {
  return import('../src/app/api/admin/technician-features/route');
}

beforeEach(() => {
  resetSessions();
  resetRateLimit();
  vi.resetModules();
  resetTechnicianStore();
  seedUser({ id: ADMIN_ID, role: 'ADMIN', name: 'Ops Admin' });
  seedUser({ id: CUSTOMER_ID, role: 'CUSTOMER' });
});

describe('getTechnicianFeatures', () => {
  it('returns the documented defaults when no configuration row exists', async () => {
    const { getTechnicianFeatures, DEFAULT_TECHNICIAN_FEATURES } = await loadConfig();
    expect(await getTechnicianFeatures()).toEqual(DEFAULT_TECHNICIAN_FEATURES);
    expect(DEFAULT_TECHNICIAN_FEATURES).toEqual({
      adminManagementEnabled: true,
      portalEnabled: false,
    });
  });

  it('honours a stored row for all four combinations', async () => {
    const combinations = [
      { adminManagementEnabled: true, portalEnabled: false },
      { adminManagementEnabled: false, portalEnabled: true },
      { adminManagementEnabled: true, portalEnabled: true },
      { adminManagementEnabled: false, portalEnabled: false },
    ];

    for (const combination of combinations) {
      vi.resetModules();
      featureRows.length = 0;
      featureRows.push({ id: 'singleton', ...combination });
      const { getTechnicianFeatures } = await loadConfig();
      expect(await getTechnicianFeatures()).toEqual(combination);
    }
  });

  it('falls back to safe defaults when the configuration cannot be read', async () => {
    storeFlags.failFeatureRead = true;
    const { getTechnicianFeatures } = await loadConfig();
    const features = await getTechnicianFeatures();
    // The ONLY safe direction: a read failure must not enable the portal.
    expect(features).toEqual({ adminManagementEnabled: true, portalEnabled: false });
  });
});

describe('GET /api/admin/technician-features', () => {
  it('rejects an anonymous caller', async () => {
    const { GET } = await loadRoute();
    const res = await GET(request('GET', '/api/admin/technician-features'));
    expect(res.status).toBe(401);
  });

  it('rejects a signed-in customer', async () => {
    signIn(CUSTOMER_ID);
    const { GET } = await loadRoute();
    const res = await GET(request('GET', '/api/admin/technician-features'));
    expect(res.status).toBe(403);
  });

  it('returns the flags to an administrator', async () => {
    signIn(ADMIN_ID);
    featureRows.push({ id: 'singleton', adminManagementEnabled: false, portalEnabled: true });
    const { GET } = await loadRoute();
    const res = await GET(request('GET', '/api/admin/technician-features'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { features: Record<string, boolean> };
    expect(body.features).toEqual({ adminManagementEnabled: false, portalEnabled: true });
    // Nothing credential-bearing may appear in a configuration response.
    expect(JSON.stringify(body)).not.toContain('token');
  });
});


describe('PATCH /api/admin/technician-features', () => {
  it('rejects an anonymous caller', async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      request('PATCH', '/api/admin/technician-features', { portalEnabled: true }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a signed-in customer', async () => {
    signIn(CUSTOMER_ID);
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      request('PATCH', '/api/admin/technician-features', { portalEnabled: true }),
    );
    expect(res.status).toBe(403);
    expect(featureRows).toHaveLength(0);
  });

  it('requires the CSRF token', async () => {
    signIn(ADMIN_ID);
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      request('PATCH', '/api/admin/technician-features', { portalEnabled: true }),
    );
    expect(res.status).toBe(403);
    expect(featureRows).toHaveLength(0);
  });

  it('rejects an unknown configuration key instead of storing it', async () => {
    signIn(ADMIN_ID);
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      request(
        'PATCH',
        '/api/admin/technician-features',
        { portalEnabled: true, technicianPassword: 'hunter2' },
        { 'x-csrf-token': CSRF },
      ),
    );
    expect(res.status).toBe(422);
    expect(featureRows).toHaveLength(0);
  });

  it('rejects an empty change rather than writing a no-op audit entry', async () => {
    signIn(ADMIN_ID);
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      request('PATCH', '/api/admin/technician-features', {}, { 'x-csrf-token': CSRF }),
    );
    expect(res.status).toBe(422);
    expect(auditRows).toHaveLength(0);
  });

  it('applies a partial change and audits the previous and new values', async () => {
    signIn(ADMIN_ID);
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      request(
        'PATCH',
        '/api/admin/technician-features',
        { portalEnabled: true },
        { 'x-csrf-token': CSRF },
      ),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { features: Record<string, boolean> };
    expect(body.features).toEqual({ adminManagementEnabled: true, portalEnabled: true });
    expect(featureRows[0]).toMatchObject({ adminManagementEnabled: true, portalEnabled: true });

    const audit = auditRows.find((row) => row.action === 'TECHNICIAN_FEATURES_CHANGED');
    expect(audit).toBeDefined();
    expect(String(audit?.metadata)).toContain('"previousPortalEnabled":false');
    expect(String(audit?.metadata)).toContain('"portalEnabled":true');
  });

  it('revokes live technician sessions when the portal is switched off', async () => {
    signIn(ADMIN_ID);
    featureRows.push({ id: 'singleton', adminManagementEnabled: true, portalEnabled: true });
    const { userId } = seedPortalTechnician();

    const { PATCH } = await loadRoute();
    const res = await PATCH(
      request(
        'PATCH',
        '/api/admin/technician-features',
        { portalEnabled: false },
        { 'x-csrf-token': CSRF },
      ),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { revokedSessions: number };
    expect(body.revokedSessions).toBe(1);
    expect(sessionRevocations).toContainEqual({ userId });
  });

  it('keeps every technician record when management is switched off', async () => {
    signIn(ADMIN_ID);
    seedPortalTechnician();
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      request(
        'PATCH',
        '/api/admin/technician-features',
        { adminManagementEnabled: false },
        { 'x-csrf-token': CSRF },
      ),
    );

    expect(res.status).toBe(200);
    expect(technicianRows).toHaveLength(1);
    expect(technicianRows[0]?.isActive).toBe(true);
  });

  it('still accepts a change while management is switched off (the unlock switch)', async () => {
    signIn(ADMIN_ID);
    featureRows.push({ id: 'singleton', adminManagementEnabled: false, portalEnabled: false });
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      request(
        'PATCH',
        '/api/admin/technician-features',
        { adminManagementEnabled: true },
        { 'x-csrf-token': CSRF },
      ),
    );
    expect(res.status).toBe(200);
    expect(featureRows[0]?.adminManagementEnabled).toBe(true);
  });
});
