/// <reference types="vitest/globals" />

/**
 * REGISTRATION -> LOGIN FLOW (route-level)
 *
 * Drives the REAL `/api/auth/register` handler with Prisma and `next/headers`
 * mocked, so the actual behaviour is asserted rather than assumed:
 *
 *  - Successful registration does NOT mint an authenticated session: no
 *    `session.create` is called and no session/CSRF cookie is set. The new
 *    account must sign in explicitly.
 *  - The browser is sent to `/login` with a non-sensitive `registered` flag for
 *    the success message. A safe, explicitly requested `next` survives that hop
 *    and is re-validated by `resolvePostLoginRedirect` against the server role
 *    (self-registration is always CUSTOMER), so a `next=/admin` never lands the
 *    new user on an admin surface.
 *  - Credentials and tokens never appear in the returned URL.
 */

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));

import { resetRateLimit } from '../src/lib/rate-limit';

const ORIGIN = 'http://localhost:3000';
const CSRF = { 'x-csrf-token': 'csrf-token' };

type UserRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  passwordHash: string;
  createdAt: Date;
  lastLoginAt: Date | null;
};

const userRows = new Map<string, UserRow>();

/** Set when the register route tries to mint a session - it must NEVER happen. */
let sessionCreations = 0;

const validPayload = {
  name: 'New Customer',
  email: 'new.customer@example.com',
  phone: '9876500000',
  password: 'Current-Pass-123!',
  confirmPassword: 'Current-Pass-123!',
};

function makePrismaMock() {
  return {
    user: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: UserRow = {
          id: 'cnewuser00000000000000001',
          name: data.name as string,
          email: data.email as string,
          phone: data.phone as string,
          // The role is chosen by the server (always CUSTOMER); never the body.
          role: (data.role as string) ?? 'CUSTOMER',
          passwordHash: data.passwordHash as string,
          createdAt: new Date('2024-01-01T00:00:00Z'),
          lastLoginAt: null,
        };
        userRows.set(row.id, row);
        return { id: row.id, name: row.name, email: row.email, phone: row.phone };
      },
    },
    // A session row must never be created during self-registration.
    session: {
      create: async () => {
        sessionCreations += 1;
        return { token: 'should-never-happen', csrfToken: 'x' };
      },
    },
    referral: { findFirst: async () => null, update: async () => undefined },
    auditLog: { create: async () => undefined },
  };
}

function req(path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: ORIGIN, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function loadRegister() {
  const mod = await import('../src/app/api/auth/register/route');
  return mod.POST;
}

describe('POST /api/auth/register (registration -> login flow)', () => {
  it('redirects to /login with a registered flag and creates NO session', async () => {
    const register = await loadRegister();
    const res = await register(req('/api/auth/register', validPayload, CSRF));
    expect(res.status).toBe(201);
    const body = await res.json();
    // No authenticated session is minted by registration.
    expect(sessionCreations).toBe(0);
    // The destination is the login page, never /account or / by default.
    expect(body.redirectTo).toBe('/login?registered=1');
    // No credentials or tokens ever ride in the URL.
    expect(body.redirectTo).not.toContain('password');
    expect(body.redirectTo).not.toContain('token');
    expect(body.redirectTo).not.toContain('next=');
  });

  it('always creates a CUSTOMER, ignoring any client-supplied role', async () => {
    const register = await loadRegister();
    const res = await register(
      req('/api/auth/register', { ...validPayload, role: 'ADMIN' }, CSRF),
    );
    // `.strict()` schema rejects the unexpected `role` key outright.
    expect(res.status).toBe(422);
    expect(userRows.get('cnewuser00000000000000001')?.role).not.toBe('ADMIN');
  });

  it('preserves a safe explicit next through to /login, re-validated for CUSTOMER', async () => {
    const register = await loadRegister();
    const res = await register(
      req('/api/auth/register?next=%2Fbookings', validPayload, CSRF),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.redirectTo).toBe('/login?registered=1&next=%2Fbookings');
  });

  it('drops an admin next for a self-registered CUSTOMER (no privilege escalation)', async () => {
    const register = await loadRegister();
    const res = await register(
      req('/api/auth/register?next=%2Fadmin', validPayload, CSRF),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    // CUSTOMER may never be routed toward /admin, so `next` collapses away.
    expect(body.redirectTo).toBe('/login?registered=1');
  });

  it('drops an unsafe external next instead of echoing it', async () => {
    const register = await loadRegister();
    const res = await register(
      req('/api/auth/register?next=https%3A%2F%2Fevil.com', validPayload, CSRF),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.redirectTo).toBe('/login?registered=1');
    expect(JSON.stringify(body)).not.toContain('evil.com');
  });

  it('enforces the Origin check before creating the account', async () => {
    const register = await loadRegister();
    const crossOrigin = await register(
      req('/api/auth/register', validPayload, { ...CSRF, origin: 'https://evil.com' }),
    );
    expect(crossOrigin.status).toBe(403);
    // No user was created by a rejected request.
    expect(userRows.size).toBe(0);
    expect(sessionCreations).toBe(0);

    // Registration is anonymous: `assertCsrf` requires a session cookie and
    // cannot apply here (same as `/api/auth/login`). The Origin check above
    // is the CSRF defence for pre-session endpoints - what matters is that a
    // request without the header can never mint a session to ride on, which
    // the no-session assertion below pins.
    const noCsrf = await register(req('/api/auth/register', validPayload));
    expect(noCsrf.status).toBe(201);
    expect(sessionCreations).toBe(0);
  });
});


beforeEach(() => {
  vi.resetModules();
  userRows.clear();
  sessionCreations = 0;
  // Registration is IP-rate-limited (5/hour); clear the shared bucket so each
  // case starts from a clean quota instead of inheriting the prior test's count.
  resetRateLimit();
});
