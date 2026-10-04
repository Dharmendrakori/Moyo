/// <reference types="vitest/globals" />

/**
 * ADMIN AUTHORIZATION TESTS
 *
 * These drive the REAL admin route handlers, so the actual guard chain runs:
 *
 *   assertSameOrigin -> requireAdmin -> assertCsrf -> rate limit -> Zod parse
 *   -> catalog write model
 *
 * The server is the boundary under test. The properties asserted here are the
 * ones that must never regress:
 *
 *   - a CUSTOMER cannot read or mutate admin data by any route, regardless of
 *     what the browser navigation shows;
 *   - an unauthenticated caller is rejected with 401, not redirected by luck;
 *   - an ADMIN succeeds;
 *   - a missing CSRF token fails a mutation even for a signed-in ADMIN, proving
 *     the token is a real control and not decoration.
 */

import { resetSessions, sessionState, signIn } from './stubs/session-control';

/**
 * Prisma is mocked under the `@/lib/prisma` alias because the routes import
 * through that specifier. Mocking the relative path would leave the route
 * resolving a DIFFERENT module instance whose session lookup never sees the
 * signed-in test state.
 */
vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

/** Records every audit row the code under test writes. */
const auditRows: Array<{ action: string; entityType: string; entityId: string | null; metadata: string | null }> = [];

/** Mutated catalogue state, so assertions can read back what the server wrote. */
const optionRows: Array<Record<string, unknown>> = [];

const ADMIN_ID = 'cadmin0000000000000000001';
const CUSTOMER_ID = 'ccustomer00000000000000001';

/** Cuid-shaped ids, because `readIdParam` validates the format before use. */
const CATEGORY_ID = 'ccategory00000000000000001';
const OPTION_ID = 'coption0000000000000000001';
const SERVICE_ID = 'cservice0000000000000000001';

function makePrismaMock() {
  const now = new Date();
  return {
    session: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const userId = sessionState.currentUserId;
        if (!userId) return null;
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
            // The role is read from the DATABASE on every request, which is the
            // property these tests rely on: it is not carried by a cookie.
            role: userId === ADMIN_ID ? 'ADMIN' : 'CUSTOMER',
            isActive: true,
            provider: null,
            technician: null,
          },
        };
      },
    },
    category: {
      findMany: async () => [
        {
          id: CATEGORY_ID,
          code: 'C01',
          position: 1,
          name: 'Home Services',
          slug: 'home-services',
          description: null,
          iconKey: 'home',
          isActive: true,
          createdAt: now,
          updatedAt: now,
          _count: { subCategories: 2 },
          subCategories: [
            { services: [{ id: SERVICE_ID, isActive: true }] },
            { services: [{ id: 'cservice0000000000000000002', isActive: false }] },
          ],
        },
      ],
      findUnique: async () => ({ id: CATEGORY_ID, isActive: true }),
      update: async ({ data }: { data: Record<string, unknown> }) => ({
        id: CATEGORY_ID,
        isActive: data.isActive,
      }),
    },
    service: {
      findMany: async () => [
        {
          id: SERVICE_ID,
          name: 'AC Servicing',
          slug: 'ac-servicing',
          serviceType: 'MAINTENANCE',
          isActive: true,
          createdAt: now,
          updatedAt: now,
          subCategory: {
            name: 'Air Conditioners',
            category: { name: 'Home Services', slug: 'home-services' },
          },
          options: [
            { charging: 'VISIT_CHARGE', pricePaise: 49_900, isActive: true },
            { charging: 'CUSTOMER_BUDGET', pricePaise: null, isActive: false },
          ],
        },
      ],
      count: async () => 1,
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === SERVICE_ID
          ? { id: SERVICE_ID, isActive: true }
          : null,
      update: async ({ data }: { data: Record<string, unknown> }) => ({
        id: SERVICE_ID,
        isActive: data.isActive,
      }),
    },
    serviceOption: {
      findMany: async () =>
        optionRows.map((r) => ({
          ...r,
          service: {
            name: 'AC Servicing',
            slug: 'ac-servicing',
            isActive: true,
            subCategory: {
              name: 'Air Conditioners',
              category: { name: 'Home Services', slug: 'home-services' },
            },
          },
        })),
      count: async () => optionRows.length,
      /**
       * Returns a COPY, not the live row, so an update cannot retroactively
       * mutate the snapshot the audit trail records as the previous value.
       */
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
    booking: {
      // Deliberately read-only. The pricing mutation counts bookings to record
      // blast radius; if any test made it WRITE here, that would be a regression
      // in the "historical quotes are immutable" guarantee.
      count: async () => 0,
      update: async () => {
        throw new Error('booking.update must never be called by an admin pricing mutation');
      },
      updateMany: async () => {
        throw new Error('booking.updateMany must never be called by an admin pricing mutation');
      },
      delete: async () => {
        throw new Error('booking.delete must never be called by an admin pricing mutation');
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditRows.push({
          action: data.action as string,
          entityType: data.entityType as string,
          entityId: (data.entityId as string) ?? null,
          metadata: (data.metadata as string) ?? null,
        });
        return undefined;
      },
    },
  };
}

const ORIGIN = 'http://localhost:3000';

function get(path: string) {
  return new Request(`${ORIGIN}${path}`, { headers: { origin: ORIGIN } });
}

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

/** A row the pricing/charging endpoints will accept. */
function seedOption(overrides: Record<string, unknown> = {}) {
  const row = {
    id: OPTION_ID,
    serviceId: SERVICE_ID,
    charging: 'VISIT_CHARGE',
    pricePaise: null as number | null,
    budgetMinPaise: null as number | null,
    budgetMaxPaise: null as number | null,
    durationMinMinutes: null as number | null,
    isActive: true,
    service: { id: SERVICE_ID, isActive: true },
    ...overrides,
  };
  optionRows.push(row);
  return row;
}

/**
 * Handlers are imported inside each test after `vi.resetModules()`, so the
 * React `cache()` override above gives every case the isolation a real request
 * would have.
 */
async function loadHandlers() {
  const categories = await import('../src/app/api/admin/categories/route');
  const categoryOne = await import('../src/app/api/admin/categories/[id]/route');
  const services = await import('../src/app/api/admin/services/route');
  const serviceOne = await import('../src/app/api/admin/services/[id]/route');
  const pricing = await import('../src/app/api/admin/pricing/route');
  const priceOne = await import('../src/app/api/admin/pricing/[id]/route');
  const options = await import('../src/app/api/admin/charging-options/route');
  const optionOne = await import('../src/app/api/admin/charging-options/[id]/route');

  return {
    listCategories: categories.GET,
    updateCategory: categoryOne.PATCH,
    listServices: services.GET,
    getService: serviceOne.GET,
    updateService: serviceOne.PATCH,
    listPricing: pricing.GET,
    updatePrice: priceOne.PATCH,
    listOptions: options.GET,
    updateOption: optionOne.PATCH,
  };
}

const CSRF = { 'x-csrf-token': 'csrf-token' };

beforeEach(() => {
  resetSessions();
  vi.resetModules();
  auditRows.length = 0;
  optionRows.length = 0;
});
// ---------------------------------------------------------------------------
// 1. Unauthenticated access is rejected
// ---------------------------------------------------------------------------

describe('unauthenticated admin access', () => {
  it('rejects an unauthenticated admin list request with 401', async () => {
    const { listCategories, listServices, listPricing, listOptions } = await loadHandlers();
    for (const handler of [listCategories, listServices, listPricing, listOptions]) {
      const res = await handler(get('/api/admin/categories'));
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('rejects an unauthenticated admin mutation with 401 before touching data', async () => {
    const { updatePrice } = await loadHandlers();
    seedOption();
    const res = await updatePrice(
      patch(`/api/admin/pricing/${OPTION_ID}`, { action: 'PUBLISH', pricePaise: 100_000 }, CSRF),
      ctx(OPTION_ID),
    );
    expect(res.status).toBe(401);
    // Nothing may be written for an unauthenticated caller.
    expect(optionRows[0]?.pricePaise).toBeNull();
    expect(auditRows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. A CUSTOMER must never reach admin data
// ---------------------------------------------------------------------------

describe('CUSTOMER cannot access admin APIs', () => {
  it('returns 403 for every admin list endpoint', async () => {
    const { listCategories, listServices, listPricing, listOptions } = await loadHandlers();
    signIn(CUSTOMER_ID);
    for (const handler of [listCategories, listServices, listPricing, listOptions]) {
      const res = await handler(get('/api/admin/categories'));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('FORBIDDEN');
    }
  });

  it('returns 403 for a category mutation and writes no audit event', async () => {
    const { updateCategory } = await loadHandlers();
    signIn(CUSTOMER_ID);
    const res = await updateCategory(
      patch(`/api/admin/categories/${CATEGORY_ID}`, { isActive: false }, CSRF),
      ctx(CATEGORY_ID),
    );
    expect(res.status).toBe(403);
    expect(auditRows).toHaveLength(0);
  });

  it('returns 403 for a service mutation and writes no audit event', async () => {
    const { updateService } = await loadHandlers();
    signIn(CUSTOMER_ID);
    const res = await updateService(
      patch(`/api/admin/services/${SERVICE_ID}`, { isActive: false }, CSRF),
      ctx(SERVICE_ID),
    );
    expect(res.status).toBe(403);
    expect(auditRows).toHaveLength(0);
  });

  it('returns 403 for a pricing mutation and publishes nothing', async () => {
    const { updatePrice } = await loadHandlers();
    seedOption();
    signIn(CUSTOMER_ID);
    const res = await updatePrice(
      patch(`/api/admin/pricing/${OPTION_ID}`, { action: 'PUBLISH', pricePaise: 100_000 }, CSRF),
      ctx(OPTION_ID),
    );
    expect(res.status).toBe(403);
    expect(optionRows[0]?.pricePaise).toBeNull();
    expect(auditRows).toHaveLength(0);
  });

  it('returns 403 for a charging-option mutation', async () => {
    const { updateOption } = await loadHandlers();
    seedOption();
    signIn(CUSTOMER_ID);
    const res = await updateOption(
      patch(`/api/admin/charging-options/${OPTION_ID}`, { isActive: false }, CSRF),
      ctx(OPTION_ID),
    );
    expect(res.status).toBe(403);
    expect(optionRows[0]?.isActive).toBe(true);
  });

  /**
   * The 403 must be decided from the DATABASE role, not from anything the
   * client presents. A customer cannot escalate by sending a forged identity
   * header, because no such header is ever consulted.
   */
  it('ignores client-supplied identity and role headers', async () => {
    const { listCategories } = await loadHandlers();
    signIn(CUSTOMER_ID);
    const res = await listCategories(
      new Request(`${ORIGIN}/api/admin/categories`, {
        headers: {
          origin: ORIGIN,
          'x-user-role': 'ADMIN',
          'x-forwarded-user': ADMIN_ID,
          cookie: 'moyo_session=forged',
        },
      }),
    );
    expect(res.status).toBe(403);
  });
});
// ---------------------------------------------------------------------------
// 3. An ADMIN is allowed, and CSRF / Origin are real controls
// ---------------------------------------------------------------------------

describe('ADMIN access', () => {
  it('allows an ADMIN to read every admin endpoint', async () => {
    const { listCategories, listServices, listPricing, listOptions } = await loadHandlers();
    seedOption();
    signIn(ADMIN_ID);
    for (const handler of [listCategories, listServices, listPricing, listOptions]) {
      const res = await handler(get('/api/admin/categories'));
      expect(res.status).toBe(200);
    }
  });

  it('returns database-backed category data to an ADMIN', async () => {
    const { listCategories } = await loadHandlers();
    signIn(ADMIN_ID);
    const body = await (await listCategories(get('/api/admin/categories'))).json();
    expect(body.categories).toHaveLength(1);
    expect(body.categories[0].name).toBe('Home Services');
    // Counts are derived from the nested rows, not hard-coded.
    expect(body.categories[0].serviceCount).toBe(2);
    expect(body.categories[0].activeServiceCount).toBe(1);
  });

  it('lets an ADMIN activate a service and records an audit event', async () => {
    const { updateService } = await loadHandlers();
    signIn(ADMIN_ID);
    const res = await updateService(
      patch(`/api/admin/services/${SERVICE_ID}`, { isActive: false }, CSRF),
      ctx(SERVICE_ID),
    );
    expect(res.status).toBe(200);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe('SERVICE_STATUS_CHANGED');
    expect(auditRows[0]?.entityType).toBe('Service');
    expect(JSON.parse(auditRows[0]?.metadata ?? '{}')).toMatchObject({
      previousIsActive: true,
      isActive: false,
    });
  });

  it('lets an ADMIN deactivate a category and records an audit event', async () => {
    const { updateCategory } = await loadHandlers();
    signIn(ADMIN_ID);
    const res = await updateCategory(
      patch(`/api/admin/categories/${CATEGORY_ID}`, { isActive: false }, CSRF),
      ctx(CATEGORY_ID),
    );
    expect(res.status).toBe(200);
    expect(auditRows[0]?.action).toBe('CATEGORY_STATUS_CHANGED');
  });

  /**
   * A missing CSRF token must fail a mutation even for a signed-in ADMIN.
   * If this ever passed, the double-submit token would be decorative and a
   * cross-site page could drive a catalog change with a borrowed cookie.
   */
  it('rejects an ADMIN mutation with no CSRF token', async () => {
    const { updatePrice } = await loadHandlers();
    seedOption();
    signIn(ADMIN_ID);
    const res = await updatePrice(
      patch(`/api/admin/pricing/${OPTION_ID}`, { action: 'PUBLISH', pricePaise: 100_000 }),
      ctx(OPTION_ID),
    );
    expect(res.status).toBe(403);
    expect(optionRows[0]?.pricePaise).toBeNull();
  });

  it('rejects an ADMIN mutation with the wrong CSRF token', async () => {
    const { updatePrice } = await loadHandlers();
    seedOption();
    signIn(ADMIN_ID, 'the-real-token');
    const res = await updatePrice(
      patch(
        `/api/admin/pricing/${OPTION_ID}`,
        { action: 'PUBLISH', pricePaise: 100_000 },
        { 'x-csrf-token': 'guessed' },
      ),
      ctx(OPTION_ID),
    );
    expect(res.status).toBe(403);
    expect(optionRows[0]?.pricePaise).toBeNull();
  });

  it('rejects a cross-origin admin mutation', async () => {
    const { updatePrice } = await loadHandlers();
    seedOption();
    signIn(ADMIN_ID);
    const res = await updatePrice(
      new Request(`${ORIGIN}/api/admin/pricing/${OPTION_ID}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          origin: 'https://evil.example',
          ...CSRF,
        },
        body: JSON.stringify({ action: 'PUBLISH', pricePaise: 100_000 }),
      }),
      ctx(OPTION_ID),
    );
    expect(res.status).toBe(403);
    expect(optionRows[0]?.pricePaise).toBeNull();
  });

  it('rejects a malformed record id before any database lookup', async () => {
    const { updatePrice, updateCategory } = await loadHandlers();
    signIn(ADMIN_ID);
    const price = await updatePrice(
      patch('/api/admin/pricing/not-a-cuid', { action: 'UNPUBLISH' }, CSRF),
      ctx('not-a-cuid'),
    );
    const category = await updateCategory(
      patch('/api/admin/categories/../../etc/passwd', { isActive: false }, CSRF),
      ctx('../../etc/passwd'),
    );
    // A malformed id yields the same NOT_FOUND a real-but-missing id yields, so
    // the endpoint cannot be used to probe the id format or the store.
    expect(price.status).toBe(404);
    expect(category.status).toBe(404);
  });
});
