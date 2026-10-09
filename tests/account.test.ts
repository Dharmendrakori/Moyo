/// <reference types="vitest/globals" />

/**
 * PERSONAL ACCOUNT API TESTS
 *
 * These drive the REAL account route handlers with the database,
 * `next/headers` and `server-only` mocked, so the actual guard chain runs:
 *
 *   assertSameOrigin -> require session -> per-account rate limit ->
 *   assertCsrf -> strict Zod parse -> session-scoped query
 */

import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { resetRateLimit } from '../src/lib/rate-limit';
import { resetSessions, sessionState, signIn } from './stubs/session-control';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));

const ORIGIN = 'http://localhost:3000';
const CSRF = { 'x-csrf-token': 'csrf-token' };

const CUSTOMER_ID = 'ccustomer00000000000000001';
const ADMIN_ID = 'cadmin0000000000000000001';
const OTHER_ID = 'cother00000000000000000001';

type UserRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  isActive: boolean;
  passwordHash: string;
  createdAt: Date;
  lastLoginAt: Date | null;
};

const userRows = new Map<string, UserRow>();
const addressRows = new Map<string, Record<string, unknown>>();
const auditRows: Array<{ action: string; metadata: string | null }> = [];
let revokedUserIds: string[] = [];

function seedUser(overrides: Partial<UserRow> & { id: string }): UserRow {
  const row: UserRow = {
    name: 'Test User',
    email: `${overrides.id}@example.com`,
    phone: '9876543210',
    role: 'CUSTOMER',
    isActive: true,
    passwordHash: bcrypt.hashSync('Current-Pass-123!', 4),
    createdAt: new Date('2024-01-01T00:00:00Z'),
    lastLoginAt: new Date('2024-06-01T00:00:00Z'),
    ...overrides,
  };
  userRows.set(row.id, row);
  return row;
}

const hash = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

/**
 * Mimics Prisma's `select`: returns only the requested top-level keys, and
 * projects nested relation `select`s too. Without this the mock would return
 * every column (including `passwordHash`), which a real query never does.
 */
function project(
  row: Record<string, unknown>,
  select?: Record<string, unknown>,
): Record<string, unknown> {
  if (!select) return row;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    const value = select[key];
    if (value && typeof value === 'object') {
      const rel = row[key];
      const nestedSelect = (value as { select?: Record<string, unknown> }).select;
      out[key] = rel && typeof rel === 'object'
        ? project(rel as Record<string, unknown>, nestedSelect)
        : (rel ?? null);
    } else {
      out[key] = row[key];
    }
  }
  return out;
}

function makePrismaMock() {
  return {
    session: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const userId = sessionState.currentUserId;
        if (!userId) return null;
        if (where.tokenHash !== hash(`token-${userId}`)) return null;
        const row = userRows.get(userId);
        if (!row) return null;
        return {
          csrfToken: sessionState.csrfByUserId.get(userId) ?? 'csrf-token',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 3_600_000),
          userId,
          user: {
            id: row.id,
            name: row.name,
            email: row.email,
            phone: row.phone,
            role: row.role,
            isActive: row.isActive,
            provider: null,
            technician: null,
          },
        };
      },
      updateMany: async ({ where }: { where: { userId?: string } }) => {
        if (where.userId) revokedUserIds.push(where.userId);
        return { count: 1 };
      },
    },
    user: {
      findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, unknown> }) => {
        const row = userRows.get(where.id);
        if (!row) return null;
        return project({ ...row, address: addressRows.get(row.id) ?? null }, select);
      },
      findFirst: async ({ where, select }: { where: { phone?: string; id?: { not: string } }; select?: Record<string, unknown> }) => {
        for (const row of userRows.values()) {
          if (where.phone !== undefined && row.phone !== where.phone) continue;
          if (where.id?.not !== undefined && row.id === where.id.not) continue;
          return project(row, select);
        }
        return null;
      },
      update: async ({ where, data, select }: { where: { id: string }; data: Record<string, unknown>; select?: Record<string, unknown> }) => {
        const row = userRows.get(where.id);
        if (!row) throw new Error('user not found in mock');
        Object.assign(row, data);
        return project({ ...row }, select);
      },
    },
    customerAddress: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        addressRows.get(where.userId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `addr-${String(data.userId)}`, ...data };
        addressRows.set(String(data.userId), row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { userId: string };
        data: Record<string, unknown>;
      }) => {
        const existing = addressRows.get(where.userId) ?? { id: `addr-${where.userId}` };
        const row = { ...existing, ...data };
        addressRows.set(where.userId, row);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditRows.push({
          action: data.action as string,
          metadata: (data.metadata as string) ?? null,
        });
        return undefined;
      },
    },
  };
}

async function loadHandlers() {
  const profile = await import('../src/app/api/account/profile/route');
  const address = await import('../src/app/api/account/address/route');
  const password = await import('../src/app/api/account/password/route');
  return {
    getProfile: profile.GET,
    patchProfile: profile.PATCH,
    putAddress: address.PUT,
    changePassword: password.POST,
  };
}

function req(
  path: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', origin: ORIGIN, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  resetSessions();
  resetRateLimit();
  vi.resetModules();
  userRows.clear();
  addressRows.clear();
  auditRows.length = 0;
  revokedUserIds = [];
  seedUser({ id: CUSTOMER_ID, role: 'CUSTOMER', email: 'customer@example.com' });
  seedUser({ id: ADMIN_ID, role: 'ADMIN', email: 'admin@example.com', phone: '9123456780' });
  seedUser({ id: OTHER_ID, role: 'CUSTOMER', email: 'other@example.com', phone: '9012345678' });
});

describe('GET /api/account/profile', () => {
  it('rejects anonymous callers with 401', async () => {
    const { getProfile } = await loadHandlers();
    const res = await getProfile(req('/api/account/profile', 'GET'));
    expect(res.status).toBe(401);
  });

  it('returns the CUSTOMER own minimal profile with no secrets', async () => {
    const { getProfile } = await loadHandlers();
    signIn(CUSTOMER_ID);
    const res = await getProfile(req('/api/account/profile', 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(CUSTOMER_ID);
    expect(body.user.email).toBe('customer@example.com');
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(body)).not.toContain('token');
  });

  it('returns the ADMIN own profile too (account page is for every role)', async () => {
    const { getProfile } = await loadHandlers();
    signIn(ADMIN_ID);
    const res = await getProfile(req('/api/account/profile', 'GET'));
    expect(res.status).toBe(200);
    expect((await res.json()).user.role).toBe('ADMIN');
  });
});

describe('PATCH /api/account/profile', () => {
  it('updates the signed-in user own name and phone', async () => {
    const { patchProfile } = await loadHandlers();
    signIn(CUSTOMER_ID);
    const res = await patchProfile(
      req('/api/account/profile', 'PATCH', { name: 'New Name', phone: '9812345678' }, CSRF),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.name).toBe('New Name');
    expect(body.user.phone).toBe('9812345678');
    expect(userRows.get(CUSTOMER_ID)?.name).toBe('New Name');
  });

  it('rejects role, email, isActive and passwordHash via strict schema', async () => {
    const { patchProfile } = await loadHandlers();
    signIn(CUSTOMER_ID);
    for (const payload of [
      { name: 'X', role: 'ADMIN' },
      { name: 'X', email: 'hacker@example.com' },
      { name: 'X', isActive: false },
      { name: 'X', passwordHash: 'x' },
    ]) {
      const res = await patchProfile(req('/api/account/profile', 'PATCH', payload, CSRF));
      expect(res.status).toBe(422);
    }
    expect(userRows.get(CUSTOMER_ID)?.role).toBe('CUSTOMER');
  });

  it('cannot touch another user record: identity comes from the session', async () => {
    const { patchProfile } = await loadHandlers();
    signIn(CUSTOMER_ID);
    const res = await patchProfile(
      req('/api/account/profile', 'PATCH', { name: 'Mine Now' }, CSRF),
    );
    expect(res.status).toBe(200);
    expect(userRows.get(OTHER_ID)?.name).toBe('Test User');
    expect(userRows.get(CUSTOMER_ID)?.name).toBe('Mine Now');
  });

  it('rejects malformed input and missing CSRF / wrong Origin', async () => {
    const { patchProfile } = await loadHandlers();
    signIn(CUSTOMER_ID);
    const bad = await patchProfile(
      req('/api/account/profile', 'PATCH', { phone: '123' }, CSRF),
    );
    expect(bad.status).toBe(422);
    const noCsrf = await patchProfile(
      req('/api/account/profile', 'PATCH', { name: 'No Csrf' }),
    );
    expect(noCsrf.status).toBe(403);
    const crossOrigin = await patchProfile(
      req(
        '/api/account/profile',
        'PATCH',
        { name: 'Cross' },
        { ...CSRF, origin: 'https://evil.com' },
      ),
    );
    expect(crossOrigin.status).toBe(403);
  });
});



describe('PUT /api/account/address', () => {
  it('creates the signed-in user own address', async () => {
    const { putAddress } = await loadHandlers();
    signIn(CUSTOMER_ID);
    const res = await putAddress(
      req(
        '/api/account/address',
        'PUT',
        {
          label: 'Home',
          line1: 'Plot 14',
          area: 'Royal Market',
          city: 'Bhopal',
          state: 'Madhya Pradesh',
          pincode: '462030',
        },
        CSRF,
      ),
    );
    expect(res.status).toBe(200);
    expect(addressRows.get(CUSTOMER_ID)?.city).toBe('Bhopal');
  });

  it('never writes another user address', async () => {
    const { putAddress } = await loadHandlers();
    signIn(CUSTOMER_ID);
    await putAddress(
      req(
        '/api/account/address',
        'PUT',
        {
          label: 'Home',
          line1: 'Mine',
          area: 'Area',
          city: 'X',
          state: 'Madhya Pradesh',
          pincode: '462030',
        },
        CSRF,
      ),
    );
    expect(addressRows.has(OTHER_ID)).toBe(false);
  });

  it('rejects anonymous and CSRF-less writes', async () => {
    const { putAddress } = await loadHandlers();
    const anon = await putAddress(req('/api/account/address', 'PUT', { line1: 'X' }, CSRF));
    expect(anon.status).toBe(401);
    signIn(CUSTOMER_ID);
    const noCsrf = await putAddress(req('/api/account/address', 'PUT', { line1: 'X' }));
    expect(noCsrf.status).toBe(403);
  });
});

describe('POST /api/account/password', () => {
  const goodChange = {
    currentPassword: 'Current-Pass-123!',
    newPassword: 'Brand-New-Pass-456!',
    confirmPassword: 'Brand-New-Pass-456!',
  };

  it('changes the password and revokes sessions', async () => {
    const { changePassword } = await loadHandlers();
    signIn(CUSTOMER_ID);
    const res = await changePassword(req('/api/account/password', 'POST', goodChange, CSRF));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requireRelogin).toBe(true);
    expect(revokedUserIds).toContain(CUSTOMER_ID);
    expect(await bcrypt.compare('Brand-New-Pass-456!', userRows.get(CUSTOMER_ID)!.passwordHash)).toBe(
      true,
    );
    const audit = auditRows.find((a) => a.action === 'PASSWORD_CHANGED');
    expect(audit).toBeDefined();
    expect(audit?.metadata ?? '').not.toMatch(/Current-Pass|Brand-New|passwordHash/i);
  });

  it('rejects a wrong current password with a generic error', async () => {
    const { changePassword } = await loadHandlers();
    signIn(CUSTOMER_ID);
    const res = await changePassword(
      req('/api/account/password', 'POST', { ...goodChange, currentPassword: 'Wrong-Pass-999!' }, CSRF),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toBe('Your current password is incorrect.');
    expect(revokedUserIds).toHaveLength(0);
  });

  it('rejects policy violations, mismatch, and reuse', async () => {
    const { changePassword } = await loadHandlers();
    signIn(CUSTOMER_ID);
    const weak = await changePassword(
      req('/api/account/password', 'POST', { ...goodChange, newPassword: 'short', confirmPassword: 'short' }, CSRF),
    );
    expect(weak.status).toBe(422);
    const mismatch = await changePassword(
      req(
        '/api/account/password',
        'POST',
        { ...goodChange, confirmPassword: 'Different-Pass-789!' },
        CSRF,
      ),
    );
    expect(mismatch.status).toBe(422);
    const reuse = await changePassword(
      req(
        '/api/account/password',
        'POST',
        {
          currentPassword: 'Current-Pass-123!',
          newPassword: 'Current-Pass-123!',
          confirmPassword: 'Current-Pass-123!',
        },
        CSRF,
      ),
    );
    expect(reuse.status).toBe(422);
  });

  it('never leaks passwords or hashes in responses', async () => {
    const { changePassword } = await loadHandlers();
    signIn(CUSTOMER_ID);
    const res = await changePassword(req('/api/account/password', 'POST', goodChange, CSRF));
    const text = await res.text();
    expect(text).not.toContain('Current-Pass-123!');
    expect(text).not.toContain('Brand-New-Pass-456!');
    expect(text).not.toContain('$2b$');
    expect(text).not.toContain('$2a$');
  });

  it('enforces CSRF, Origin, and authentication', async () => {
    const { changePassword } = await loadHandlers();
    const anon = await changePassword(req('/api/account/password', 'POST', goodChange, CSRF));
    expect(anon.status).toBe(401);
    signIn(CUSTOMER_ID);
    const noCsrf = await changePassword(req('/api/account/password', 'POST', goodChange));
    expect(noCsrf.status).toBe(403);
    const crossOrigin = await changePassword(
      req('/api/account/password', 'POST', goodChange, {
        ...CSRF,
        origin: 'https://evil.com',
      }),
    );
    expect(crossOrigin.status).toBe(403);
  });

  it('works for ADMIN users as well', async () => {
    const { changePassword } = await loadHandlers();
    signIn(ADMIN_ID);
    const res = await changePassword(
      req(
        '/api/account/password',
        'POST',
        {
          currentPassword: 'Current-Pass-123!',
          newPassword: 'Admin-New-Pass-789!',
          confirmPassword: 'Admin-New-Pass-789!',
        },
        CSRF,
      ),
    );
    expect(res.status).toBe(200);
    expect(revokedUserIds).toContain(ADMIN_ID);
  });
});
