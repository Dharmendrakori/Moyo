/// <reference types="vitest/globals" />

/**
 * BULK CATALOGUE ADMINISTRATION TESTS
 *
 * These drive the REAL bulk route handlers, so the full guard chain runs on
 * every call: assertSameOrigin -> requireAdmin -> assertCsrf -> rate limit ->
 * Zod parse -> catalog write model. Prisma is mocked with a small in-memory
 * store modelling the relationships the write logic depends on (service ->
 * bookings, subCategory -> services, the unique slug).
 *
 * Pinned properties that must never regress:
 *   - only a signed-in ADMIN may mutate; CSRF and Origin are enforced;
 *   - malformed/empty ids, unknown actions, an EDIT with no field, a patch on a
 *     non-EDIT action and over-long batches are rejected before any write;
 *   - bulk activate/deactivate touches only `isActive` and is audited;
 *   - bulk delete NEVER removes a service referenced by a booking, and reports
 *     the protected record back (partial success);
 *   - bulk edit writes only the supplied fields;
 *   - bulk create derives the slug, refuses duplicates, and creates the three
 *     charging options disabled and unpriced.
 */

import { createHash } from 'node:crypto';
import { resetSessions, sessionState, signIn } from './stubs/session-control';

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

// Cuid-shaped ids, because every id is validated before use.
const CAT_1 = 'ccategory00000000000000001';
const CAT_2 = 'ccategory00000000000000002';
const SUB_1 = 'csubcategory000000000000001';
const SUB_2 = 'csubcategory000000000000002';
const SVC_1 = 'cservice00000000000000001';
const SVC_2 = 'cservice00000000000000002';
const SVC_3 = 'cservice00000000000000003';

type Store = {
  categories: Array<Record<string, any>>;
  subCategories: Array<Record<string, any>>;
  services: Array<Record<string, any>>;
  options: Array<Record<string, any>>;
  bookings: Array<Record<string, any>>;
};

/**
 * The in-memory store lives at MODULE scope, not inside the mock factory.
 *
 * `vi.resetModules()` re-evaluates the route (and its `vi.mock` factory) before
 * every test, so a store created inside the factory would be a brand-new empty
 * object each time and would diverge from what `seedCatalogue()` wrote. Keeping
 * it here - and clearing it in `beforeEach` - means the mock, the seed and the
 * assertions all observe the same arrays, exactly as the other route suites do.
 */
const store: Store = { categories: [], subCategories: [], services: [], options: [], bookings: [] };

function getStore(): Store {
  return store;
}

/** Applies a Prisma-style `select` projection to a row. */
function project(row: Record<string, any>, select?: Record<string, any>) {
  if (!select) return { ...row };
  const out: Record<string, any> = {};
  for (const key of Object.keys(select)) {
    out[key] = key === '_count' ? row._count : row[key];
  }
  return out;
}

function makePrismaMock() {
  const now = new Date();
  let idCounter = 0;
  const nextId = () => `cnew${(idCounter++).toString().padStart(20, '0')}`;
  const countBy = (rows: Array<Record<string, any>>, key: string, value: unknown) =>
    rows.filter((r) => r[key] === value).length;

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
    category: {
      findMany: async (args: any = {}) => {
        const where = args.where ?? {};
        let rows = [...store.categories];
        if (where.id?.in) rows = rows.filter((c) => where.id.in.includes(c.id));
        if (args.select?._count) {
          rows = rows.map((c) => ({
            ...c,
            _count: { subCategories: countBy(store.subCategories, 'categoryId', c.id) },
          }));
        }
        return rows.map((c) => project(c, args.select));
      },
      updateMany: async (args: any) => {
        const ids: string[] = args.where?.id?.in ?? [];
        let count = 0;
        for (const c of store.categories) {
          if (ids.includes(c.id)) {
            Object.assign(c, args.data);
            count += 1;
          }
        }
        return { count };
      },
    },
    subCategory: {
      findMany: async (args: any = {}) => {
        const where = args.where ?? {};
        let rows = [...store.subCategories];
        if (where.id?.in) rows = rows.filter((s) => where.id.in.includes(s.id));
        return rows.map((s) => project(s, args.select));
      },
    },
    service: {
      findMany: async (args: any = {}) => {
        const where = args.where ?? {};
        let rows = [...store.services];
        if (where.id?.in) rows = rows.filter((s) => where.id.in.includes(s.id));
        if (where.slug?.in) rows = rows.filter((s) => where.slug.in.includes(s.slug));
        if (args.select?._count) {
          rows = rows.map((s) => ({
            ...s,
            _count: { bookings: countBy(store.bookings, 'serviceId', s.id) },
          }));
        }
        return rows.map((s) => project(s, args.select));
      },
      updateMany: async (args: any) => {
        const ids: string[] = args.where?.id?.in ?? [];
        let count = 0;
        for (const s of store.services) {
          if (ids.includes(s.id)) {
            Object.assign(s, args.data);
            count += 1;
          }
        }
        return { count };
      },
      deleteMany: async (args: any) => {
        const ids: string[] = args.where?.id?.in ?? [];
        const before = store.services.length;
        // Mutate in place (do not reassign) so `beforeEach`'s `.length = 0` reset
        // and every closure over `store.*` keep seeing the same arrays.
        for (let i = store.services.length - 1; i >= 0; i--) {
          const svc = store.services[i];
          if (svc && ids.includes(svc.id)) store.services.splice(i, 1);
        }
        for (let i = store.options.length - 1; i >= 0; i--) {
          const opt = store.options[i];
          if (opt && ids.includes(opt.serviceId)) store.options.splice(i, 1);
        }
        return { count: before - store.services.length };
      },
      create: async (args: any) => {
        const row = { id: nextId(), createdAt: now, updatedAt: now, ...args.data };
        delete row.options;
        store.services.push(row);
        for (const opt of args.data.options?.create ?? []) {
          store.options.push({ id: nextId(), serviceId: row.id, pricePaise: null, ...opt });
        }
        return project(row, args.select);
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        auditRows.push({ action: data.action, entityType: data.entityType, metadata: data.metadata ?? null });
        return { id: nextId() };
      },
    },
    $transaction: async (ops: any) => {
      if (typeof ops === 'function') return ops(makePrismaMock());
      return Promise.all(ops);
    },
  };
}

async function loadHandlers() {
  const serviceBulk = await import('../src/app/api/admin/services/bulk/route');
  const categoryBulk = await import('../src/app/api/admin/categories/bulk/route');
  const services = await import('../src/app/api/admin/services/route');
  return {
    serviceBulk: serviceBulk.POST,
    categoryBulk: categoryBulk.POST,
    createServices: services.POST,
  };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

/** Seeds two categories, two subcategories and three services. */
function seedCatalogue() {
  const store = getStore();
  store.categories.push(
    { id: CAT_1, name: 'Home Services', slug: 'home-services', isActive: true, position: 1 },
    { id: CAT_2, name: 'Business Services', slug: 'business-services', isActive: false, position: 2 },
  );
  store.subCategories.push(
    { id: SUB_1, categoryId: CAT_1, name: 'Wiring', slug: 'wiring', isActive: true },
    { id: SUB_2, categoryId: CAT_2, name: 'Office', slug: 'office', isActive: true },
  );
  store.services.push(
    { id: SVC_1, subCategoryId: SUB_1, name: 'AC Repair', slug: 'ac-repair', serviceType: 'REPAIR', isActive: true, description: 'd1', includedWork: 'w1' },
    { id: SVC_2, subCategoryId: SUB_1, name: 'Fan Install', slug: 'fan-install', serviceType: 'INSTALLATION', isActive: false, description: null, includedWork: null },
    { id: SVC_3, subCategoryId: SUB_2, name: 'Office Wiring', slug: 'office-wiring', serviceType: 'REPAIR', isActive: true, description: null, includedWork: null },
  );
}

/** Attaches a booking to a service, making it undeletable. */
function addBooking(serviceId: string) {
  getStore().bookings.push({ id: `cbooking${serviceId.slice(-6)}`, serviceId });
}

beforeEach(() => {
  resetSessions();
  vi.resetModules();
  auditRows.length = 0;
  // The in-memory catalogue store is module-scoped, so wipe it before each test.
  store.categories.length = 0;
  store.subCategories.length = 0;
  store.services.length = 0;
  store.options.length = 0;
  store.bookings.length = 0;
});

// ---------------------------------------------------------------------------
// 1. Authorization: only a signed-in ADMIN, with CSRF and Origin, may mutate
// ---------------------------------------------------------------------------

describe('bulk authorization', () => {
  it('rejects an unauthenticated caller on every bulk route with 401', async () => {
    const { serviceBulk, categoryBulk, createServices } = await loadHandlers();
    seedCatalogue();
    const requests = [
      serviceBulk(post('/api/admin/services/bulk', { ids: [SVC_1], action: 'ACTIVATE' }, CSRF)),
      categoryBulk(post('/api/admin/categories/bulk', { ids: [CAT_1], action: 'ACTIVATE' }, CSRF)),
      createServices(post('/api/admin/services', { services: [{ subCategoryId: SUB_1, name: 'X', serviceType: 'REPAIR' }] }, CSRF)),
    ];
    for (const res of await Promise.all(requests)) {
      expect(res.status).toBe(401);
    }
    expect(auditRows).toHaveLength(0);
  });

  it('rejects a CUSTOMER on every bulk route with 403 and writes nothing', async () => {
    const { serviceBulk, categoryBulk, createServices } = await loadHandlers();
    seedCatalogue();
    signIn(CUSTOMER_ID);
    const responses = await Promise.all([
      serviceBulk(post('/api/admin/services/bulk', { ids: [SVC_1], action: 'DELETE' }, CSRF)),
      categoryBulk(post('/api/admin/categories/bulk', { ids: [CAT_1], action: 'DEACTIVATE' }, CSRF)),
      createServices(post('/api/admin/services', { services: [{ subCategoryId: SUB_1, name: 'X', serviceType: 'REPAIR' }] }, CSRF)),
    ]);
    for (const res of responses) expect(res.status).toBe(403);
    // Nothing was changed: the seeded services and categories are intact.
    expect(getStore().services.find((s) => s.id === SVC_1)?.isActive).toBe(true);
    expect(getStore().categories.find((c) => c.id === CAT_1)?.isActive).toBe(true);
    expect(auditRows).toHaveLength(0);
  });

  it('rejects an ADMIN bulk mutation with no CSRF token', async () => {
    const { serviceBulk } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);
    const res = await serviceBulk(post('/api/admin/services/bulk', { ids: [SVC_1], action: 'DEACTIVATE' }));
    expect(res.status).toBe(403);
    expect(getStore().services.find((s) => s.id === SVC_1)?.isActive).toBe(true);
  });

  it('rejects a cross-origin ADMIN bulk mutation', async () => {
    const { serviceBulk } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);
    const res = await serviceBulk(
      new Request(`${ORIGIN}/api/admin/services/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: 'https://evil.example', ...CSRF },
        body: JSON.stringify({ ids: [SVC_1], action: 'DEACTIVATE' }),
      }),
    );
    expect(res.status).toBe(403);
    expect(getStore().services.find((s) => s.id === SVC_1)?.isActive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Validation: the server rejects malformed input before any write
// ---------------------------------------------------------------------------

describe('bulk validation', () => {
  it('rejects an empty id list, a malformed id and an unknown action', async () => {
    const { serviceBulk } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);

    const empty = await serviceBulk(post('/api/admin/services/bulk', { ids: [], action: 'ACTIVATE' }, CSRF));
    expect(empty.status).toBe(422);

    const malformed = await serviceBulk(post('/api/admin/services/bulk', { ids: ['not-a-cuid'], action: 'ACTIVATE' }, CSRF));
    expect(malformed.status).toBe(422);

    const unknown = await serviceBulk(post('/api/admin/services/bulk', { ids: [SVC_1], action: 'NUKE' }, CSRF));
    expect(unknown.status).toBe(422);

    expect(auditRows).toHaveLength(0);
  });

  it('rejects an EDIT with no field and a patch attached to a non-EDIT action', async () => {
    const { serviceBulk } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);

    const noField = await serviceBulk(post('/api/admin/services/bulk', { ids: [SVC_1], action: 'EDIT' }, CSRF));
    expect(noField.status).toBe(422);

    const patchOnActivate = await serviceBulk(
      post('/api/admin/services/bulk', { ids: [SVC_1], action: 'ACTIVATE', patch: { serviceType: 'REPAIR' } }, CSRF),
    );
    expect(patchOnActivate.status).toBe(422);

    // Nothing was written by the rejected attempts.
    expect(getStore().services.find((s) => s.id === SVC_1)?.serviceType).toBe('REPAIR');
    expect(auditRows).toHaveLength(0);
  });

  it('rejects a bulk id list longer than the cap', async () => {
    const { serviceBulk } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);
    const tooMany = Array.from({ length: 201 }, (_, i) => `cservice${i.toString().padStart(20, '0')}`);
    const res = await serviceBulk(post('/api/admin/services/bulk', { ids: tooMany, action: 'ACTIVATE' }, CSRF));
    expect(res.status).toBe(422);
  });

  it('rejects an unexpected field (mass-assignment attempt) on a bulk route', async () => {
    const { serviceBulk } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);
    const res = await serviceBulk(
      post('/api/admin/services/bulk', { ids: [SVC_1], action: 'ACTIVATE', isActive: true, role: 'ADMIN' }, CSRF),
    );
    expect(res.status).toBe(422);
  });

  it('rejects a bulk DELETE attempt on official categories (schema only allows activation)', async () => {
    const { categoryBulk } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);
    const res = await categoryBulk(post('/api/admin/categories/bulk', { ids: [CAT_1], action: 'DELETE' }, CSRF));
    expect(res.status).toBe(422);
    // The category is untouched.
    expect(getStore().categories.find((c) => c.id === CAT_1)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. Bulk category activation (the only bulk action official categories allow)
// ---------------------------------------------------------------------------

describe('bulk category activation', () => {
  it('activates and deactivates several categories and audits each call', async () => {
    const { categoryBulk } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);

    const activate = await categoryBulk(post('/api/admin/categories/bulk', { ids: [CAT_1, CAT_2], action: 'ACTIVATE' }, CSRF));
    expect(activate.status).toBe(200);
    const activateBody = await activate.json();
    expect(activateBody.result.affected).toBe(2);
    expect(getStore().categories.every((c) => c.isActive)).toBe(true);
    expect(auditRows[0]?.action).toBe('CATEGORY_BULK_STATUS_CHANGED');

    const deactivate = await categoryBulk(post('/api/admin/categories/bulk', { ids: [CAT_1], action: 'DEACTIVATE' }, CSRF));
    expect(deactivate.status).toBe(200);
    expect(getStore().categories.find((c) => c.id === CAT_1)?.isActive).toBe(false);
    // The other category is NOT touched by a single-id deactivate.
    expect(getStore().categories.find((c) => c.id === CAT_2)?.isActive).toBe(true);
    expect(auditRows[1]?.action).toBe('CATEGORY_BULK_STATUS_CHANGED');
  });

  it('never changes the official name, code or position, only availability', async () => {
    const { categoryBulk } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);
    await categoryBulk(post('/api/admin/categories/bulk', { ids: [CAT_1], action: 'DEACTIVATE' }, CSRF));
    const cat = getStore().categories.find((c) => c.id === CAT_1);
    expect(cat?.name).toBe('Home Services');
    expect(cat?.position).toBe(1);
    expect(cat?.slug).toBe('home-services');
  });

  it('reports ids that do not exist as notFound', async () => {
    const { categoryBulk } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);
    const res = await categoryBulk(
      post('/api/admin/categories/bulk', { ids: [CAT_1, 'cmissing000000000000000001'], action: 'ACTIVATE' }, CSRF),
    );
    const body = await res.json();
    expect(body.result.affected).toBe(1);
    expect(body.result.notFound).toEqual(['cmissing000000000000000001']);
  });
});

// ---------------------------------------------------------------------------
// 4. Bulk service activation / deactivation
// ---------------------------------------------------------------------------

describe('bulk service activation', () => {
  it('activates several services and writes only isActive', async () => {
    const { serviceBulk } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);
    const res = await serviceBulk(post('/api/admin/services/bulk', { ids: [SVC_1, SVC_2], action: 'ACTIVATE' }, CSRF));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.affected).toBe(2);
    expect(getStore().services.find((s) => s.id === SVC_2)?.isActive).toBe(true);
    // name / type are untouched.
    expect(getStore().services.find((s) => s.id === SVC_2)?.serviceType).toBe('INSTALLATION');
    expect(auditRows[0]?.action).toBe('SERVICE_BULK_STATUS_CHANGED');
    expect(JSON.parse(auditRows[0]?.metadata ?? '{}')).toMatchObject({ action: 'ACTIVATE', affected: 2 });
  });

  it('deactivates several services in one call', async () => {
    const { serviceBulk } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);
    const res = await serviceBulk(post('/api/admin/services/bulk', { ids: [SVC_1, SVC_3], action: 'DEACTIVATE' }, CSRF));
    expect(res.status).toBe(200);
    expect(getStore().services.find((s) => s.id === SVC_1)?.isActive).toBe(false);
    expect(getStore().services.find((s) => s.id === SVC_3)?.isActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Bulk edit: only the supplied fields change
// ---------------------------------------------------------------------------

describe('bulk service edit', () => {
  it('edits the service type of several services and audits the fields', async () => {
    const { serviceBulk } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);
    const res = await serviceBulk(
      post('/api/admin/services/bulk', { ids: [SVC_1, SVC_3], action: 'EDIT', patch: { serviceType: 'MAINTENANCE' } }, CSRF),
    );
    expect(res.status).toBe(200);
    expect(getStore().services.find((s) => s.id === SVC_1)?.serviceType).toBe('MAINTENANCE');
    expect(getStore().services.find((s) => s.id === SVC_3)?.serviceType).toBe('MAINTENANCE');
    // SVC_2 was not selected, so its type is unchanged.
    expect(getStore().services.find((s) => s.id === SVC_2)?.serviceType).toBe('INSTALLATION');
    expect(auditRows[0]?.action).toBe('SERVICE_BULK_EDITED');
    expect(JSON.parse(auditRows[0]?.metadata ?? '{}')).toMatchObject({ fields: 'serviceType', affected: 2 });
  });

  it('edits description without touching other fields, and clears it when empty', async () => {
    const { serviceBulk } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);
    const set = await serviceBulk(
      post('/api/admin/services/bulk', { ids: [SVC_1], action: 'EDIT', patch: { description: 'New copy' } }, CSRF),
    );
    expect(set.status).toBe(200);
    expect(getStore().services.find((s) => s.id === SVC_1)?.description).toBe('New copy');
    expect(getStore().services.find((s) => s.id === SVC_1)?.serviceType).toBe('REPAIR');

    const clear = await serviceBulk(
      post('/api/admin/services/bulk', { ids: [SVC_1], action: 'EDIT', patch: { description: '' } }, CSRF),
    );
    expect(clear.status).toBe(200);
    expect(getStore().services.find((s) => s.id === SVC_1)?.description).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Bulk delete: services referenced by a booking are NEVER removed
// ---------------------------------------------------------------------------

describe('bulk service delete', () => {
  it('deletes services with no bookings and audits the deletion', async () => {
    const { serviceBulk } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);
    const res = await serviceBulk(post('/api/admin/services/bulk', { ids: [SVC_1, SVC_3], action: 'DELETE' }, CSRF));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.affected).toBe(2);
    expect(getStore().services.find((s) => s.id === SVC_1)).toBeUndefined();
    expect(getStore().services.find((s) => s.id === SVC_3)).toBeUndefined();
    // SVC_2 was not selected.
    expect(getStore().services.find((s) => s.id === SVC_2)).toBeTruthy();
    expect(auditRows[0]?.action).toBe('SERVICE_BULK_DELETED');
  });

  it('protects a service referenced by a booking and reports it (partial success)', async () => {
    const { serviceBulk } = await loadHandlers();
    seedCatalogue();
    addBooking(SVC_1); // SVC_1 has history; SVC_3 does not.
    signIn(ADMIN_ID);
    const res = await serviceBulk(post('/api/admin/services/bulk', { ids: [SVC_1, SVC_3], action: 'DELETE' }, CSRF));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Only the booking-free service is removed.
    expect(body.result.affected).toBe(1);
    expect(body.result.protected).toHaveLength(1);
    expect(body.result.protected[0]).toMatchObject({ id: SVC_1, name: 'AC Repair' });
    expect(body.result.protected[0].reason).toContain('booking');
    // The protected service survives; the free one is gone.
    expect(getStore().services.find((s) => s.id === SVC_1)).toBeTruthy();
    expect(getStore().services.find((s) => s.id === SVC_3)).toBeUndefined();
    expect(JSON.parse(auditRows[0]?.metadata ?? '{}')).toMatchObject({ deleted: 1, protected: 1 });
  });

  it('deletes nothing and protects everything when all selected have bookings', async () => {
    const { serviceBulk } = await loadHandlers();
    seedCatalogue();
    addBooking(SVC_1);
    addBooking(SVC_2);
    signIn(ADMIN_ID);
    const res = await serviceBulk(post('/api/admin/services/bulk', { ids: [SVC_1, SVC_2], action: 'DELETE' }, CSRF));
    const body = await res.json();
    expect(body.result.affected).toBe(0);
    expect(body.result.protected).toHaveLength(2);
    expect(getStore().services).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 7. Bulk create: slug derived server-side, duplicates refused, options seeded
// ---------------------------------------------------------------------------

describe('bulk service create', () => {
  it('creates several services with derived slugs and three disabled, unpriced options', async () => {
    const { createServices } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);
    const res = await createServices(
      post(
        '/api/admin/services',
        {
          services: [
            { subCategoryId: SUB_1, name: 'Geyser Repair', serviceType: 'REPAIR', isActive: true },
            { subCategoryId: SUB_1, name: 'Inverter Setup', serviceType: 'INSTALLATION' },
          ],
        },
        CSRF,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.created).toHaveLength(2);
    // Slug is derived, never taken from the client.
    expect(body.result.created[0].slug).toBe('geyser-repair');
    const geyser = getStore().services.find((s) => s.slug === 'geyser-repair');
    expect(geyser).toBeTruthy();
    // Each new service has its three charging options, all disabled and unpriced.
    const opts = getStore().options.filter((o) => o.serviceId === geyser?.id);
    expect(opts).toHaveLength(3);
    expect(opts.every((o) => o.isActive === false)).toBe(true);
    expect(opts.every((o) => o.pricePaise === null)).toBe(true);
    expect(auditRows[0]?.action).toBe('SERVICE_BULK_CREATED');
  });

  it('skips a duplicate name and an unknown subcategory, creating only the valid one', async () => {
    const { createServices } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);
    const res = await createServices(
      post(
        '/api/admin/services',
        {
          services: [
            { subCategoryId: SUB_1, name: 'AC Repair', serviceType: 'REPAIR' }, // duplicate slug
            { subCategoryId: 'cbadsubcategory0000000001', name: 'Ghost Service', serviceType: 'REPAIR' }, // bad sub
            { subCategoryId: SUB_1, name: 'Brand New Service', serviceType: 'MAINTENANCE' }, // valid
          ],
        },
        CSRF,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.created).toHaveLength(1);
    expect(body.result.created[0].slug).toBe('brand-new-service');
    expect(body.result.skipped).toHaveLength(2);
    // No service with the duplicate or ghost name was persisted.
    expect(getStore().services.some((s) => s.slug === 'ac-repair' && s.id !== SVC_1)).toBe(false);
    expect(getStore().services.some((s) => s.name === 'Ghost Service')).toBe(false);
  });

  it('rejects a create with an empty list or an over-long batch', async () => {
    const { createServices } = await loadHandlers();
    seedCatalogue();
    signIn(ADMIN_ID);
    const empty = await createServices(post('/api/admin/services', { services: [] }, CSRF));
    expect(empty.status).toBe(422);

    const tooMany = Array.from({ length: 51 }, () => ({ subCategoryId: SUB_1, name: 'X', serviceType: 'REPAIR' }));
    const big = await createServices(post('/api/admin/services', { services: tooMany }, CSRF));
    expect(big.status).toBe(422);
    expect(getStore().services).toHaveLength(3);
  });
});






