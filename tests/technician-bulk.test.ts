/// <reference types="vitest/globals" />

/**
 * BULK TECHNICIAN MANAGEMENT TESTS
 *
 * Drives the real route handler, so the full chain runs on every call:
 * assertSameOrigin -> requireAdmin -> assertCsrf -> rate limit -> feature switch
 * -> strict discriminated Zod -> per-record reads -> conditional writes -> audit.
 *
 * What is pinned here:
 *  - an empty, duplicated or oversized selection is rejected at the boundary;
 *  - non-admin and missing-CSRF callers are refused, and a disabled management
 *    capability blocks bulk writes while leaving the roster readable;
 *  - activate/deactivate follow the account invariant (login + sessions);
 *  - deactivation is REFUSED while any selected technician still has open work;
 *  - availability never makes an inactive technician assignment-eligible;
 *  - skill/area edits merge (never replace) and remove only what was named;
 *  - re-issued invitations return one-time links and skip ineligible accounts;
 *  - every operation writes exactly one auditable summary event.
 */

import { resetSessions, signIn } from './stubs/session-control';
import { resetRateLimit } from '../src/lib/rate-limit';
import {
  ADMIN_ID,
  BOOKING_ID,
  CSRF,
  CUSTOMER_ID,
  ORIGIN,
  OTHER_TECH_ID,
  TECHNICIAN_ID,
  auditRows,
  featureRows,
  jobRows,
  makePrismaMock,
  resetTechnicianStore,
  seedJob,
  seedTechnician,
  seedUser,
  sessionRevocations,
  technicianRows,
  userRows,
} from './stubs/technician-store';

vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));
vi.mock('../src/lib/prisma', () => ({ prisma: makePrismaMock() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

function bulkRequest(body: unknown, csrf: string | null = CSRF) {
  return new Request(`${ORIGIN}/api/admin/technicians/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      origin: ORIGIN,
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
    },
    body: JSON.stringify(body),
  });
}

const CUID = (n: number) => `ctechnician${String(n).padStart(14, '0')}`;

async function loadBulk() {
  return (await import('../src/app/api/admin/technicians/bulk/route')).POST;
}

beforeEach(() => {
  resetSessions();
  resetRateLimit();
  vi.resetModules();
  resetTechnicianStore();
  seedUser({ id: ADMIN_ID, role: 'ADMIN', name: 'Ops Admin' });
  seedUser({ id: CUSTOMER_ID, role: 'CUSTOMER' });
});

describe('bulk request boundary', () => {
  it('rejects an empty selection', async () => {
    signIn(ADMIN_ID);
    const POST = await loadBulk();
    const res = await POST(bulkRequest({ ids: [], action: 'ACTIVATE' }));
    expect(res.status).toBe(422);
  });

  it('rejects duplicate ids instead of silently collapsing them', async () => {
    signIn(ADMIN_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar' });
    const POST = await loadBulk();
    const res = await POST(
      bulkRequest({ ids: [TECHNICIAN_ID, TECHNICIAN_ID], action: 'ACTIVATE' }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { fields?: Record<string, string> } };
    expect(body.error?.fields?.ids).toMatch(/duplicate/i);
  });

  it('rejects a batch larger than the cap', async () => {
    signIn(ADMIN_ID);
    const POST = await loadBulk();
    const ids = Array.from({ length: 51 }, (_, i) => CUID(i));
    const res = await POST(bulkRequest({ ids, action: 'ACTIVATE' }));
    expect(res.status).toBe(422);
  });

  it('rejects values on an action that takes none', async () => {
    signIn(ADMIN_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar' });
    const POST = await loadBulk();
    const res = await POST(
      bulkRequest({ ids: [TECHNICIAN_ID], action: 'ACTIVATE', values: ['AC servicing'] }),
    );
    expect(res.status).toBe(422);
  });

  it('rejects a value action with no values', async () => {
    signIn(ADMIN_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar' });
    const POST = await loadBulk();
    const res = await POST(bulkRequest({ ids: [TECHNICIAN_ID], action: 'ADD_SKILLS' }));
    expect(res.status).toBe(422);
  });

  it('rejects a non-admin caller', async () => {
    signIn(CUSTOMER_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar' });
    const POST = await loadBulk();
    const res = await POST(bulkRequest({ ids: [TECHNICIAN_ID], action: 'DEACTIVATE' }));
    expect(res.status).toBe(403);
    expect(technicianRows[0]?.isActive).toBe(true);
  });

  it('requires the CSRF token', async () => {
    signIn(ADMIN_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar' });
    const POST = await loadBulk();
    const res = await POST(bulkRequest({ ids: [TECHNICIAN_ID], action: 'DEACTIVATE' }, null));
    expect(res.status).toBe(403);
    expect(technicianRows[0]?.isActive).toBe(true);
  });

  it('refuses every action while technician management is switched off', async () => {
    signIn(ADMIN_ID);
    featureRows.push({ id: 'singleton', adminManagementEnabled: false, portalEnabled: false });
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar' });

    const POST = await loadBulk();
    const res = await POST(bulkRequest({ ids: [TECHNICIAN_ID], action: 'SET_UNAVAILABLE' }));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('ADMIN_MANAGEMENT_DISABLED');
    expect(technicianRows[0]?.isAvailable).toBe(true);
  });
});

describe('activation state', () => {
  it('activates the profiles and re-enables their logins', async () => {
    signIn(ADMIN_ID);
    seedUser({ id: 'ctechuser0000000000000001', role: 'TECHNICIAN', isActive: false });
    seedTechnician({
      id: TECHNICIAN_ID,
      displayName: 'Ravi Kumar',
      userId: 'ctechuser0000000000000001',
      isActive: false,
    });

    const POST = await loadBulk();
    const res = await POST(bulkRequest({ ids: [TECHNICIAN_ID], action: 'ACTIVATE' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { affected: number } };
    expect(body.result.affected).toBe(1);
    expect(technicianRows[0]?.isActive).toBe(true);
    expect(userRows.find((u) => u.id === 'ctechuser0000000000000001')?.isActive).toBe(true);
    expect(auditRows.map((a) => a.action)).toContain('TECHNICIAN_BULK_CHANGED');
  });

  it('deactivates profiles, disables logins and revokes sessions', async () => {
    signIn(ADMIN_ID);
    seedUser({ id: 'ctechuser0000000000000001', role: 'TECHNICIAN' });
    seedTechnician({
      id: TECHNICIAN_ID,
      displayName: 'Ravi Kumar',
      userId: 'ctechuser0000000000000001',
    });

    const POST = await loadBulk();
    const res = await POST(bulkRequest({ ids: [TECHNICIAN_ID], action: 'DEACTIVATE' }));

    expect(res.status).toBe(200);
    expect(technicianRows[0]?.isActive).toBe(false);
    expect(userRows.find((u) => u.id === 'ctechuser0000000000000001')?.isActive).toBe(false);
    expect(sessionRevocations).toContainEqual({ userId: 'ctechuser0000000000000001' });
  });

  it('refuses to deactivate a technician who still has open work', async () => {
    signIn(ADMIN_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar' });
    seedJob({ id: BOOKING_ID, status: 'SERVICE_IN_PROGRESS', technicianId: TECHNICIAN_ID });

    const POST = await loadBulk();
    const res = await POST(bulkRequest({ ids: [TECHNICIAN_ID], action: 'DEACTIVATE' }));

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('ACTIVE_ASSIGNMENTS');
    expect(body.error?.message).toMatch(/Nothing was changed/);
    expect(technicianRows[0]?.isActive).toBe(true);
    expect(jobRows[0]?.status).toBe('SERVICE_IN_PROGRESS');
  });

  it('allows deactivation once the open work is gone', async () => {
    signIn(ADMIN_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar' });
    seedJob({ id: BOOKING_ID, status: 'CLOSED', technicianId: TECHNICIAN_ID });

    const POST = await loadBulk();
    const res = await POST(bulkRequest({ ids: [TECHNICIAN_ID], action: 'DEACTIVATE' }));
    expect(res.status).toBe(200);
    expect(technicianRows[0]?.isActive).toBe(false);
  });
});

describe('availability', () => {
  it('marks active technicians unavailable and skips deactivated ones', async () => {
    signIn(ADMIN_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar', isAvailable: true });
    seedTechnician({
      id: OTHER_TECH_ID,
      displayName: 'Retired Tech',
      isActive: false,
      isAvailable: false,
    });

    const POST = await loadBulk();
    const res = await POST(
      bulkRequest({ ids: [TECHNICIAN_ID, OTHER_TECH_ID], action: 'SET_UNAVAILABLE' }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { affected: number; skipped: Array<{ reason: string }> };
    };
    expect(body.result.affected).toBe(1);
    expect(body.result.skipped[0]?.reason).toMatch(/Deactivated technicians cannot be marked available/);
    expect(technicianRows.find((t) => t.id === TECHNICIAN_ID)?.isAvailable).toBe(false);
  });

  it('never makes an inactive technician available', async () => {
    signIn(ADMIN_ID);
    seedTechnician({
      id: TECHNICIAN_ID,
      displayName: 'Ravi Kumar',
      isActive: false,
      isAvailable: false,
    });

    const POST = await loadBulk();
    const res = await POST(bulkRequest({ ids: [TECHNICIAN_ID], action: 'SET_AVAILABLE' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { affected: number; skipped: Array<{ reason: string }> };
    };
    expect(body.result.affected).toBe(0);
    expect(body.result.skipped[0]?.reason).toMatch(/Deactivated technicians cannot be marked available/);
    expect(technicianRows[0]?.isAvailable).toBe(false);
  });
});

describe('skills and service areas', () => {
  it('adds skills without replacing the existing ones, de-duplicating by case', async () => {
    signIn(ADMIN_ID);
    seedTechnician({
      id: TECHNICIAN_ID,
      displayName: 'Ravi Kumar',
      skills: 'AC servicing, Plumbing',
    });

    const POST = await loadBulk();
    const res = await POST(
      bulkRequest({
        ids: [TECHNICIAN_ID],
        action: 'ADD_SKILLS',
        values: ['refrigeration', 'AC servicing'],
      }),
    );

    expect(res.status).toBe(200);
    expect(technicianRows[0]?.skills).toBe('AC servicing, Plumbing, refrigeration');
  });

  it('removes only the skills that were named', async () => {
    signIn(ADMIN_ID);
    seedTechnician({
      id: TECHNICIAN_ID,
      displayName: 'Ravi Kumar',
      skills: 'AC servicing, Plumbing, Refrigeration',
    });

    const POST = await loadBulk();
    const res = await POST(
      bulkRequest({ ids: [TECHNICIAN_ID], action: 'REMOVE_SKILLS', values: ['Plumbing'] }),
    );

    expect(res.status).toBe(200);
    expect(technicianRows[0]?.skills).toBe('AC servicing, Refrigeration');
  });

  it('reports a value that is already present as skipped, not affected', async () => {
    signIn(ADMIN_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar', skills: 'Refrigeration' });

    const POST = await loadBulk();
    const res = await POST(
      bulkRequest({ ids: [TECHNICIAN_ID], action: 'ADD_SKILLS', values: ['Refrigeration'] }),
    );

    const body = (await res.json()) as {
      result: { affected: number; skipped: Array<{ reason: string }> };
    };
    expect(body.result.affected).toBe(0);
    expect(body.result.skipped[0]?.reason).toBe('Already present');
  });

  it('adds service areas while preserving unrelated ones', async () => {
    signIn(ADMIN_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar', serviceAreas: 'Bhopal' });

    const POST = await loadBulk();
    const res = await POST(
      bulkRequest({ ids: [TECHNICIAN_ID], action: 'ADD_SERVICE_AREAS', values: ['Indore'] }),
    );

    expect(res.status).toBe(200);
    expect(technicianRows[0]?.serviceAreas).toBe('Bhopal, Indore');
  });

  it('skips a record whose merged list would exceed the column limit', async () => {
    signIn(ADMIN_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar', skills: 'x'.repeat(295) });

    const POST = await loadBulk();
    const res = await POST(
      bulkRequest({ ids: [TECHNICIAN_ID], action: 'ADD_SKILLS', values: ['Refrigeration'] }),
    );

    const body = (await res.json()) as {
      result: { affected: number; skipped: Array<{ reason: string }> };
    };
    expect(body.result.affected).toBe(0);
    expect(body.result.skipped[0]?.reason).toMatch(/exceed 300 characters/);
  });
});

describe('portal invitations', () => {
  it('re-issues invitations for unactivated accounts and returns one-time links', async () => {
    signIn(ADMIN_ID);
    featureRows.push({ id: 'singleton', adminManagementEnabled: true, portalEnabled: true });
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

    const POST = await loadBulk();
    const res = await POST(bulkRequest({ ids: [TECHNICIAN_ID], action: 'REISSUE_INVITATIONS' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { affected: number; activationLinks?: Array<{ path: string }> };
    };
    expect(body.result.affected).toBe(1);
    expect(body.result.activationLinks?.[0]?.path).toMatch(/^\/technician\/activate\//);

    // The raw path is a credential and must never reach the audit log.
    const audit = auditRows.find((a) => a.action === 'TECHNICIAN_BULK_CHANGED');
    expect(String(audit?.metadata)).not.toContain('/technician/activate/');
  });

  it('skips activated accounts and profiles without a login', async () => {
    signIn(ADMIN_ID);
    featureRows.push({ id: 'singleton', adminManagementEnabled: true, portalEnabled: true });
    seedUser({ id: 'ctechuser0000000000000001', role: 'TECHNICIAN', activationExpiresAt: null });
    seedTechnician({
      id: TECHNICIAN_ID,
      displayName: 'Ravi Kumar',
      userId: 'ctechuser0000000000000001',
    });
    seedTechnician({ id: OTHER_TECH_ID, displayName: 'No Login Tech' });

    const POST = await loadBulk();
    const res = await POST(
      bulkRequest({ ids: [TECHNICIAN_ID, OTHER_TECH_ID], action: 'REISSUE_INVITATIONS' }),
    );

    const body = (await res.json()) as {
      result: { affected: number; skipped: Array<{ reason: string }> };
    };
    const reasons = body.result.skipped.map((item) => item.reason).join(' | ');
    expect(body.result.affected).toBe(0);
    expect(reasons).toMatch(/already activated/);
    expect(reasons).toMatch(/No portal login/);
  });
});

describe('CSV export', () => {
  async function loadExport() {
    return (await import('../src/app/api/admin/technicians/export/route')).GET;
  }

  it('exports the selected profiles without credentials and neutralises formulas', async () => {
    signIn(ADMIN_ID);
    seedTechnician({
      id: TECHNICIAN_ID,
      displayName: '=cmd|calc',
      skills: '+SUM(A1)',
      phone: '9876500001',
    });

    const GET = await loadExport();
    const res = await GET(
      new Request(`${ORIGIN}/api/admin/technicians/export?ids=${TECHNICIAN_ID}`),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('cache-control')).toContain('no-store');

    const csv = await res.text();
    expect(csv).toContain('"name","mobile"');
    // A spreadsheet must treat these as text, not formulas.
    expect(csv).toContain('"\'=cmd|calc"');
    expect(csv).toContain('"\'+SUM(A1)"');
    // No credential material is exported.
    expect(csv.toLowerCase()).not.toContain('password');
    expect(csv.toLowerCase()).not.toContain('activation');
    expect(csv.toLowerCase()).not.toContain('token');
  });

  it('rejects an empty selection', async () => {
    signIn(ADMIN_ID);
    const GET = await loadExport();
    const res = await GET(new Request(`${ORIGIN}/api/admin/technicians/export`));
    expect(res.status).toBe(422);
  });

  it('rejects a non-admin caller', async () => {
    signIn(CUSTOMER_ID);
    seedTechnician({ id: TECHNICIAN_ID, displayName: 'Ravi Kumar' });
    const GET = await loadExport();
    const res = await GET(
      new Request(`${ORIGIN}/api/admin/technicians/export?ids=${TECHNICIAN_ID}`),
    );
    expect(res.status).toBe(403);
  });
});

