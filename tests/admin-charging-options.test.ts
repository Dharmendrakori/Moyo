/// <reference types="vitest/globals" />

/**
 * UNIFIED CHARGING-OPTIONS TABLE TESTS
 *
 * The refactor groups the three `ServiceOption` rows under one service row.
 * These tests pin the contract the UI depends on:
 *
 * - one row per service with all three options attached in canonical order,
 * - independent persistence: PATCHing one option row never touches the other
 *   two rows,
 * - the new query schema accepts search/category/charging/status/pagination
 *   and rejects unknown keys or out-of-range pages.
 */

import { createHash } from 'node:crypto';
import { resetSessions, sessionState, signIn } from './stubs/session-control';
import { adminChargingServiceQuerySchema } from '../src/lib/validation';

vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));
// `listAdminChargingServices` is imported directly by the query suites below.
// Vitest keys `vi.mock` by resolved path, and the alias and relative specifiers
// resolve through different mock-registry entries, so the same factory is
// registered under the relative path as well to cover the direct import site.
vi.mock('../src/lib/prisma', () => ({ prisma: makePrismaMock() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

const auditRows: Array<{ action: string; entityType: string; metadata: string | null }> = [];
const optionRows: Array<Record<string, unknown>> = [];
const serviceRows: Array<Record<string, unknown>> = [];

/**
 * Mirrors `sha256` from src/lib/crypto.ts. The session lookup key is a hash of
 * the cookie token (`token-<userId>`), so the mock must derive the same value.
 */
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

function makePrismaMock() {
  const now = new Date();
  return {
    session: {
      findUnique: async ({ where }: { where?: { tokenHash?: string } } = {}) => {
        const userId = sessionState.currentUserId;
        if (!userId) return null;
        // The cookie value is `token-<id>`, stored hashed. A wrong hash means
        // "no such session", exactly like the real lookup.
        if (where?.tokenHash !== hash(`token-${userId}`)) return null;
        return {
          csrfToken: sessionState.csrfByUserId.get(userId) ?? 'csrf-token',
          revokedAt: null,
          expiresAt: new Date(now.getTime() + 3_600_000),
          userId,
          user: {
            id: userId,
            name: 'Ops Admin',
            email: 'admin@example.com',
            phone: '9876543210',
            role: 'ADMIN',
            isActive: true,
            provider: null,
            technician: null,
          },
        };
      },
    },
    service: {
      findMany: async (args: { where?: unknown; skip?: number; take?: number }) => {
        const where = (args ?? {}).where as Record<string, unknown> | undefined;
        let rows = [...serviceRows].sort((a, b) =>
          String((a as Record<string, unknown>).name).localeCompare(
            String((b as Record<string, unknown>).name),
          ),
        );
        const or = where?.OR as Array<Record<string, Record<string, string>>> | undefined;
        const term = or?.[0]?.name?.contains ?? or?.[1]?.slug?.contains;
        if (term) rows = rows.filter((r) => String((r as Record<string, unknown>).name).includes(term));
        const category = (where?.subCategory as { category?: { slug?: string } } | undefined)?.category?.slug;
        if (category) rows = rows.filter((r) => (r as Record<string, unknown>).categorySlug === category);
        const skip = args?.skip ?? 0;
        const take = args?.take ?? rows.length;
        return rows.slice(skip, skip + take);
      },
      count: async () => serviceRows.length,
    },
    serviceOption: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = optionRows.find((o) => o.id === where.id);
        return row ? { ...row } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = optionRows.find((o) => o.id === where.id);
        if (!row) return null;
        Object.assign(row, data);
        return { ...row };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditRows.push({
          action: data.action as string,
          entityType: data.entityType as string,
          metadata: (data.metadata as string) ?? null,
        });
        return undefined;
      },
    },
  };
}

const ORIGIN = 'http://localhost:3000';
const CSRF = { 'x-csrf-token': 'csrf-token' };

function patch(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const ADMIN_ID = 'cadmin0000000000000000001';
const SERVICE_ID = 'cservice0000000000000000001';

function seedOption(overrides: Record<string, unknown> = {}, id: string = 'c00000000000000000001') {
  const row = {
    id,
    serviceId: SERVICE_ID,
    charging: 'VISIT_CHARGE',
    pricePaise: null,
    budgetMinPaise: null,
    budgetMaxPaise: null,
    durationMinMinutes: null,
    isActive: true,
    service: { id: SERVICE_ID, isActive: true },
    ...overrides,
  };
  optionRows.push(row);

  return row;
}

async function loadRoute() {
  const route = await import('../src/app/api/admin/charging-options/[id]/route');
  return route;
}

beforeEach(() => {
  resetSessions();
  vi.resetModules();
  auditRows.length = 0;
  optionRows.length = 0;
  serviceRows.length = 0;
  signIn(ADMIN_ID);
});

function seedServiceTableRow(id: string, name: string, active: Record<string, boolean>) {
  serviceRows.push({
    id,
    name,
    isActive: true,
    subCategory: { name: 'General', category: { name: 'Home', slug: 'home' } },
    options: (['VISIT_CHARGE', 'FIXED_CHARGE', 'CUSTOMER_BUDGET'] as const).map((charging) => ({
      id: `${id}-${charging}`,
      charging,
      isActive: active[charging] ?? false,
      pricePaise: null,
      budgetMinPaise: null,
      budgetMaxPaise: null,
      durationMinMinutes: null,
    })),
  });
}

describe('unified charging-services query', () => {
  it('returns one row per service with all three options attached', async () => {
    seedServiceTableRow('svc-1', 'AC Repair', { VISIT_CHARGE: true, CUSTOMER_BUDGET: true });
    seedServiceTableRow('svc-2', 'Plumbing', {});
    const { listAdminChargingServices } = await import('../src/lib/admin-catalog');

    const result = await listAdminChargingServices({
      charging: 'ALL',
      status: 'ALL',
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(2);
    expect(result.items.map((s) => s.serviceId)).toEqual(['svc-1', 'svc-2']);
    for (const item of result.items) {
      expect(item.options.map((o) => o.charging)).toEqual([
        'VISIT_CHARGE',
        'FIXED_CHARGE',
        'CUSTOMER_BUDGET',
      ]);
    }
    expect(result.items[0]?.options.find((o) => o.charging === 'VISIT_CHARGE')?.isActive).toBe(true);
    expect(result.items[0]?.options.find((o) => o.charging === 'FIXED_CHARGE')?.isActive).toBe(false);
  });

  it('filters by search term and paginates', async () => {
    seedServiceTableRow('svc-1', 'AC Repair', {});
    seedServiceTableRow('svc-2', 'AC Installation', {});
    seedServiceTableRow('svc-3', 'Plumbing', {});
    const { listAdminChargingServices } = await import('../src/lib/admin-catalog');

    const page = await listAdminChargingServices({
      q: 'AC',
      charging: 'ALL',
      status: 'ALL',
      page: 2,
      pageSize: 1,
    });
    expect(page.items).toHaveLength(1);
    // Alphabetical by service name: AC Installation, AC Repair — page 2 is Repair.
    expect(page.items[0]?.serviceName).toBe('AC Repair');
  });
});

describe('independent option persistence', () => {
  it('updating Visit Charge leaves Fixed Charge and Customer Budget untouched', async () => {
    seedOption({ charging: 'VISIT_CHARGE', isActive: true }, 'c00000000000000000001');
    seedOption({ charging: 'FIXED_CHARGE', isActive: false }, 'c00000000000000000002');
    seedOption(
      { charging: 'CUSTOMER_BUDGET', isActive: true, budgetMinPaise: 50_000, budgetMaxPaise: 5_00_000 },
      'c00000000000000000003',
    );
    const route = await loadRoute();

    const res = await route.PATCH(
      patch('/api/admin/charging-options/c00000000000000000001', { isActive: false }, CSRF),
      ctx('c00000000000000000001'),
    );
    expect(res.status).toBe(200);

    const visit = optionRows.find((o) => o.id === 'c00000000000000000001');
    const fixed = optionRows.find((o) => o.id === 'c00000000000000000002');
    const budget = optionRows.find((o) => o.id === 'c00000000000000000003');
    expect(visit?.isActive).toBe(false);
    expect(fixed?.isActive).toBe(false);
    expect(budget?.isActive).toBe(true);
    expect(budget?.budgetMinPaise).toBe(50_000);
    expect(budget?.budgetMaxPaise).toBe(5_00_000);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe('CHARGING_OPTION_CHANGED');
  });

  it('updating the Customer Budget range leaves the other two options untouched', async () => {
    seedOption({ charging: 'VISIT_CHARGE', isActive: true }, 'c00000000000000000001');
    seedOption({ charging: 'FIXED_CHARGE', isActive: false }, 'c00000000000000000002');
    seedOption({ charging: 'CUSTOMER_BUDGET', isActive: false }, 'c00000000000000000003');
    const route = await loadRoute();

    const res = await route.PATCH(
      patch(
        '/api/admin/charging-options/c00000000000000000003',
        { isActive: true, budgetMinPaise: 100_000, budgetMaxPaise: 9_00_000 },
        CSRF,
      ),
      ctx('c00000000000000000003'),
    );
    expect(res.status).toBe(200);

    expect(optionRows.find((o) => o.id === 'c00000000000000000001')?.isActive).toBe(true);
    expect(optionRows.find((o) => o.id === 'c00000000000000000002')?.isActive).toBe(false);
    const budget = optionRows.find((o) => o.id === 'c00000000000000000003');
    expect(budget?.budgetMinPaise).toBe(100_000);
    expect(budget?.budgetMaxPaise).toBe(9_00_000);
  });
});

describe('adminChargingServiceQuerySchema', () => {
  it('applies defaults and accepts all filters', () => {
    const parsed = adminChargingServiceQuerySchema.parse({
      q: '  AC ',
      category: 'home',
      charging: 'VISIT_CHARGE',
      status: 'ENABLED',
      page: '2',
      pageSize: '20',
    });
    expect(parsed.q).toBe('AC');
    expect(parsed.category).toBe('home');
    expect(parsed.charging).toBe('VISIT_CHARGE');
    expect(parsed.status).toBe('ENABLED');
    expect(parsed.page).toBe(2);
  });

  it('rejects unknown keys and invalid enums', () => {
    expect(() => adminChargingServiceQuerySchema.parse({ unknown: 'x' })).toThrow();
    expect(adminChargingServiceQuerySchema.safeParse({ charging: 'NOPE' }).success).toBe(false);
    expect(adminChargingServiceQuerySchema.safeParse({ status: 'NOPE' }).success).toBe(false);
    expect(adminChargingServiceQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  });
});
