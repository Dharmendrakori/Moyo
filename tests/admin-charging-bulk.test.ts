/// <reference types="vitest/globals" />

/**
 * BULK CHARGING-OPTIONS TESTS
 *
 * These drive the REAL bulk route handler, so the full guard chain runs on
 * every call: assertSameOrigin -> requireAdmin -> assertCsrf -> rate limit ->
 * Zod parse -> catalog write model. Prisma is mocked with a small in-memory
 * store modelling services and their three ServiceOption rows.
 *
 * Pinned properties that must never regress:
 *   - only a signed-in ADMIN may mutate; CSRF and Origin are enforced;
 *   - the `.strict()` schema accepts ONLY ids + charging + ENABLE/DISABLE, so
 *     a price, a budget bound or a role can never be smuggled in;
 *   - one request changes ONE charging type; the other two options of every
 *     selected service are untouched, and only `isActive` is written;
 *   - enabling Customer Budget without a configured range is skipped per row
 *     and reported - a partial batch is never flattened into a fake success;
 *   - every applied batch is audited as CHARGING_OPTION_BULK_CHANGED.
 */

import { createHash } from 'node:crypto';
import { resetSessions, sessionState, signIn } from './stubs/session-control';
import { adminChargingBulkSchema } from '../src/lib/validation';

vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));
vi.mock('../src/lib/prisma', () => ({ prisma: makePrismaMock() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

const auditRows: Array<{ action: string; entityType: string; metadata: string | null }> = [];
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

const ADMIN_ID = 'cadmin0000000000000000001';
const CUSTOMER_ID = 'ccustomer00000000000000001';
const ORIGIN = 'http://localhost:3000';
const CSRF = { 'x-csrf-token': 'csrf-token' };

// Cuid-shaped ids, because every submitted id is validated before use.
const SVC_1 = 'cservice00000000000000001';
const SVC_2 = 'cservice00000000000000002';
const MISSING = 'cmissing000000000000000001';

type OptionRow = {
  id: string;
  serviceId: string;
  charging: string;
  isActive: boolean;
  pricePaise: number | null;
  budgetMinPaise: number | null;
  budgetMaxPaise: number | null;
  durationMinMinutes: number | null;
};

const serviceRows: Array<{ id: string; name: string }> = [];
const optionRows: OptionRow[] = [];

/** Seeds one service with all three charging options disabled and unpriced. */
function seedService(
  id: string,
  name: string,
  overrides: Partial<Record<'VISIT_CHARGE' | 'FIXED_CHARGE' | 'CUSTOMER_BUDGET', Partial<OptionRow>>> = {},
) {
  serviceRows.push({ id, name });
  for (const charging of ['VISIT_CHARGE', 'FIXED_CHARGE', 'CUSTOMER_BUDGET'] as const) {
    optionRows.push({
      id: `coption${optionRows.length.toString().padStart(20, '0')}`,
      serviceId: id,
      charging,
      isActive: false,
      pricePaise: null,
      budgetMinPaise: charging === 'CUSTOMER_BUDGET' ? 50_000 : null,
      budgetMaxPaise: charging === 'CUSTOMER_BUDGET' ? 5_00_000 : null,
      durationMinMinutes: null,
      ...overrides[charging],
    });
  }
}

function optionOf(serviceId: string, charging: string): OptionRow | undefined {
  return optionRows.find((o) => o.serviceId === serviceId && o.charging === charging);
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
    service: {
      findMany: async (args: { where?: { id?: { in?: string[] } } } = {}) => {
        const ids = args?.where?.id?.in;
        let rows = [...serviceRows];
        if (Array.isArray(ids)) rows = rows.filter((s) => ids.includes(s.id));
        return rows.map((s) => ({ ...s }));
      },
    },
    serviceOption: {
      findMany: async (
        args: { where?: { serviceId?: { in?: string[] }; charging?: string } } = {},
      ) => {
        let rows = [...optionRows];
        const ids = args?.where?.serviceId?.in;
        if (Array.isArray(ids)) rows = rows.filter((o) => ids.includes(o.serviceId));
        const charging = args?.where?.charging;
        if (typeof charging === 'string') rows = rows.filter((o) => o.charging === charging);
        return rows.map((o) => ({ ...o }));
      },
      updateMany: async (args: { where: { id: { in: string[] } }; data: Record<string, unknown> }) => {
        const ids = args.where?.id?.in ?? [];
        let count = 0;
        for (const row of optionRows) {
          if (ids.includes(row.id)) {
            Object.assign(row, args.data);
            count++;
          }
        }
        return { count };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditRows.push({
          action: String(data.action),
          entityType: String(data.entityType),
          metadata: (data.metadata as string | null) ?? null,
        });
        return undefined;
      },
    },
  };
}

async function loadHandlers() {
  vi.resetModules();
  const mod = await import('../src/app/api/admin/charging-options/bulk/route');
  return { bulk: mod.POST };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetSessions();
  serviceRows.length = 0;
  optionRows.length = 0;
  auditRows.length = 0;
});

// ---------------------------------------------------------------------------
// 1. Authorization: only a live ADMIN session may drive a bulk write
// ---------------------------------------------------------------------------

describe('bulk charging options: authorization', () => {
  const payload = { ids: [SVC_1], charging: 'VISIT_CHARGE', action: 'ENABLE' };

  it('rejects an unauthenticated caller before any write', async () => {
    const { bulk } = await loadHandlers();
    seedService(SVC_1, 'AC Installation');
    const res = await bulk(post('/api/admin/charging-options/bulk', payload, CSRF));
    expect(res.status).toBe(401);
    expect(optionOf(SVC_1, 'VISIT_CHARGE')?.isActive).toBe(false);
    expect(auditRows).toHaveLength(0);
  });

  it('rejects a CUSTOMER session', async () => {
    const { bulk } = await loadHandlers();
    seedService(SVC_1, 'AC Installation');
    signIn(CUSTOMER_ID);
    const res = await bulk(post('/api/admin/charging-options/bulk', payload, CSRF));
    expect(res.status).toBe(403);
    expect(optionOf(SVC_1, 'VISIT_CHARGE')?.isActive).toBe(false);
    expect(auditRows).toHaveLength(0);
  });

  it('rejects an ADMIN bulk mutation with no CSRF token', async () => {
    const { bulk } = await loadHandlers();
    seedService(SVC_1, 'AC Installation');
    signIn(ADMIN_ID);
    const res = await bulk(post('/api/admin/charging-options/bulk', payload));
    expect(res.status).toBe(403);
    expect(optionOf(SVC_1, 'VISIT_CHARGE')?.isActive).toBe(false);
  });

  it('rejects a cross-origin ADMIN bulk mutation', async () => {
    const { bulk } = await loadHandlers();
    seedService(SVC_1, 'AC Installation');
    signIn(ADMIN_ID);
    const res = await bulk(
      new Request(`${ORIGIN}/api/admin/charging-options/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: 'https://evil.example', ...CSRF },
        body: JSON.stringify(payload),
      }),
    );
    expect(res.status).toBe(403);
    expect(optionOf(SVC_1, 'VISIT_CHARGE')?.isActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Validation: the server rejects malformed input before any write
// ---------------------------------------------------------------------------

describe('bulk charging options: validation', () => {
  it('rejects an empty id list, a malformed id and unknown enums', async () => {
    const { bulk } = await loadHandlers();
    seedService(SVC_1, 'AC Installation');
    signIn(ADMIN_ID);

    const empty = await bulk(
      post('/api/admin/charging-options/bulk', { ids: [], charging: 'VISIT_CHARGE', action: 'ENABLE' }, CSRF),
    );
    expect(empty.status).toBe(422);

    const malformed = await bulk(
      post('/api/admin/charging-options/bulk', { ids: ['not-a-cuid'], charging: 'VISIT_CHARGE', action: 'ENABLE' }, CSRF),
    );
    expect(malformed.status).toBe(422);

    const badCharging = await bulk(
      post('/api/admin/charging-options/bulk', { ids: [SVC_1], charging: 'HOURLY', action: 'ENABLE' }, CSRF),
    );
    expect(badCharging.status).toBe(422);

    const badAction = await bulk(
      post('/api/admin/charging-options/bulk', { ids: [SVC_1], charging: 'VISIT_CHARGE', action: 'ACTIVATE' }, CSRF),
    );
    expect(badAction.status).toBe(422);

    expect(optionOf(SVC_1, 'VISIT_CHARGE')?.isActive).toBe(false);
    expect(auditRows).toHaveLength(0);
  });

  it('rejects smuggled fields - a price, a budget bound or a role (strict schema)', async () => {
    const { bulk } = await loadHandlers();
    seedService(SVC_1, 'AC Installation');
    signIn(ADMIN_ID);

    const withPrice = await bulk(
      post(
        '/api/admin/charging-options/bulk',
        { ids: [SVC_1], charging: 'VISIT_CHARGE', action: 'ENABLE', pricePaise: 100_000 },
        CSRF,
      ),
    );
    expect(withPrice.status).toBe(422);

    const withRole = await bulk(
      post(
        '/api/admin/charging-options/bulk',
        { ids: [SVC_1], charging: 'VISIT_CHARGE', action: 'ENABLE', role: 'ADMIN' },
        CSRF,
      ),
    );
    expect(withRole.status).toBe(422);

    // The enabled option is unpriced: publication stays on its own endpoint.
    expect(optionOf(SVC_1, 'VISIT_CHARGE')?.pricePaise).toBeNull();
    expect(auditRows).toHaveLength(0);
  });

  it('rejects a batch longer than the 200-id cap', async () => {
    const { bulk } = await loadHandlers();
    signIn(ADMIN_ID);
    const tooMany = Array.from({ length: 201 }, (_, i) => `cservice${i.toString().padStart(20, '0')}`);
    const res = await bulk(
      post('/api/admin/charging-options/bulk', { ids: tooMany, charging: 'VISIT_CHARGE', action: 'ENABLE' }, CSRF),
    );
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// 3. Bulk enable / disable: one charging type per request, independence kept
// ---------------------------------------------------------------------------

describe('bulk charging options: enable / disable', () => {
  it('enables one charging type across services and touches nothing else', async () => {
    const { bulk } = await loadHandlers();
    seedService(SVC_1, 'AC Installation', { VISIT_CHARGE: { isActive: true } });
    seedService(SVC_2, 'AC Repair', { CUSTOMER_BUDGET: { isActive: true } });
    signIn(ADMIN_ID);

    const res = await bulk(
      post(
        '/api/admin/charging-options/bulk',
        { ids: [SVC_1, SVC_2], charging: 'FIXED_CHARGE', action: 'ENABLE' },
        CSRF,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toMatchObject({ requested: 2, affected: 2, notFound: [] });

    // Only Fixed Charge changed on both services.
    expect(optionOf(SVC_1, 'FIXED_CHARGE')?.isActive).toBe(true);
    expect(optionOf(SVC_2, 'FIXED_CHARGE')?.isActive).toBe(true);
    // The other two charging types are untouched, including pre-existing state.
    expect(optionOf(SVC_1, 'VISIT_CHARGE')?.isActive).toBe(true);
    expect(optionOf(SVC_1, 'CUSTOMER_BUDGET')?.isActive).toBe(false);
    expect(optionOf(SVC_2, 'VISIT_CHARGE')?.isActive).toBe(false);
    expect(optionOf(SVC_2, 'CUSTOMER_BUDGET')?.isActive).toBe(true);
    // Budget bounds survive a non-budget bulk change.
    expect(optionOf(SVC_2, 'CUSTOMER_BUDGET')?.budgetMinPaise).toBe(50_000);

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe('CHARGING_OPTION_BULK_CHANGED');
    expect(JSON.parse(auditRows[0]?.metadata ?? '{}')).toMatchObject({
      charging: 'FIXED_CHARGE',
      action: 'ENABLE',
      requested: 2,
      affected: 2,
    });
  });

  it('disabling Customer Budget keeps its range and never touches the other two', async () => {
    const { bulk } = await loadHandlers();
    seedService(SVC_1, 'AC Installation', {
      VISIT_CHARGE: { isActive: true },
      CUSTOMER_BUDGET: { isActive: true, budgetMinPaise: 1_00_000, budgetMaxPaise: 9_00_000 },
    });
    signIn(ADMIN_ID);

    const res = await bulk(
      post(
        '/api/admin/charging-options/bulk',
        { ids: [SVC_1], charging: 'CUSTOMER_BUDGET', action: 'DISABLE' },
        CSRF,
      ),
    );
    expect(res.status).toBe(200);

    const budget = optionOf(SVC_1, 'CUSTOMER_BUDGET');
    expect(budget?.isActive).toBe(false);
    // Only `isActive` is written: the configured range stays for a later enable.
    expect(budget?.budgetMinPaise).toBe(1_00_000);
    expect(budget?.budgetMaxPaise).toBe(9_00_000);
    expect(optionOf(SVC_1, 'VISIT_CHARGE')?.isActive).toBe(true);
    expect(optionOf(SVC_1, 'FIXED_CHARGE')?.isActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Partial failures are applied safely and reported honestly
// ---------------------------------------------------------------------------

describe('bulk charging options: partial failures', () => {
  it('applies the batch to existing services and reports missing ids as notFound', async () => {
    const { bulk } = await loadHandlers();
    seedService(SVC_1, 'AC Installation');
    signIn(ADMIN_ID);

    const res = await bulk(
      post(
        '/api/admin/charging-options/bulk',
        { ids: [SVC_1, MISSING], charging: 'VISIT_CHARGE', action: 'ENABLE' },
        CSRF,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.affected).toBe(1);
    expect(body.result.notFound).toEqual([MISSING]);
    expect(optionOf(SVC_1, 'VISIT_CHARGE')?.isActive).toBe(true);
  });

  it('skips Customer Budget rows with no configured range and reports them by name', async () => {
    const { bulk } = await loadHandlers();
    seedService(SVC_1, 'AC Installation'); // budget range present (default)
    seedService(SVC_2, 'AC Repair', { CUSTOMER_BUDGET: { budgetMinPaise: null, budgetMaxPaise: null } });
    signIn(ADMIN_ID);

    const res = await bulk(
      post(
        '/api/admin/charging-options/bulk',
        { ids: [SVC_1, SVC_2], charging: 'CUSTOMER_BUDGET', action: 'ENABLE' },
        CSRF,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // The honest accounting: one changed, one skipped with the reason.
    expect(body.result.affected).toBe(1);
    expect(body.result.skipped).toHaveLength(1);
    expect(body.result.skipped[0]).toMatchObject({ name: 'AC Repair' });
    expect(body.result.skipped[0]?.reason).toContain('budget range');

    expect(optionOf(SVC_1, 'CUSTOMER_BUDGET')?.isActive).toBe(true);
    expect(optionOf(SVC_2, 'CUSTOMER_BUDGET')?.isActive).toBe(false);

    // A batch that skipped a row is still audited, with the skip counted.
    expect(auditRows[0]?.action).toBe('CHARGING_OPTION_BULK_CHANGED');
    expect(JSON.parse(auditRows[0]?.metadata ?? '{}')).toMatchObject({ affected: 1, skipped: 1 });
  });

  it('reports zero affected without claiming success when every id is unknown', async () => {
    const { bulk } = await loadHandlers();
    signIn(ADMIN_ID);
    const res = await bulk(
      post(
        '/api/admin/charging-options/bulk',
        { ids: [MISSING], charging: 'VISIT_CHARGE', action: 'ENABLE' },
        CSRF,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.affected).toBe(0);
    expect(body.result.notFound).toEqual([MISSING]);
    expect(auditRows[0]?.action).toBe('CHARGING_OPTION_BULK_CHANGED');
  });
});

// ---------------------------------------------------------------------------
// 5. The schema itself
// ---------------------------------------------------------------------------

describe('adminChargingBulkSchema', () => {
  it('accepts a valid payload and de-duplicates ids', () => {
    const parsed = adminChargingBulkSchema.parse({
      ids: [SVC_1, SVC_2, SVC_1],
      charging: 'CUSTOMER_BUDGET',
      action: 'DISABLE',
    });
    expect(parsed.ids).toEqual([SVC_1, SVC_2]);
    expect(parsed.charging).toBe('CUSTOMER_BUDGET');
    expect(parsed.action).toBe('DISABLE');
  });

  it('rejects unknown keys, empty ids and invalid enums', () => {
    expect(
      adminChargingBulkSchema.safeParse({ ids: [SVC_1], charging: 'VISIT_CHARGE', action: 'ENABLE', pricePaise: 1 })
        .success,
    ).toBe(false);
    expect(adminChargingBulkSchema.safeParse({ ids: [], charging: 'VISIT_CHARGE', action: 'ENABLE' }).success).toBe(false);
    expect(adminChargingBulkSchema.safeParse({ ids: [SVC_1], charging: 'SOMETIMES', action: 'ENABLE' }).success).toBe(
      false,
    );
    expect(adminChargingBulkSchema.safeParse({ ids: [SVC_1], charging: 'VISIT_CHARGE', action: 'TOGGLE' }).success).toBe(
      false,
    );
    expect(adminChargingBulkSchema.safeParse({ ids: ['oops'], charging: 'VISIT_CHARGE', action: 'ENABLE' }).success).toBe(
      false,
    );
  });
});
