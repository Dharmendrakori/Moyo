import 'server-only';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import type { Role } from './domain';
import { prisma } from './prisma';
import { generateToken, hashIp, sha256 } from './crypto';
import { env } from './env';

/**
 * SERVER-SIDE SESSIONS + RBAC
 *
 * Design decisions:
 * - Opaque database-backed sessions instead of JWT. This means logout, role
 *   changes and account suspension take effect immediately on the next request,
 *   which a self-contained JWT cannot guarantee.
 * - The cookie contains only a random token. The database stores only its
 *   SHA-256 hash, so a database leak does not yield usable session cookies.
 * - A per-session CSRF token is stored server-side and must be echoed in a
 *   header on every state-changing request (double-submit, server-verified).
 * - `sessionVersion` on the user is bumped on password change/role change,
 *   which invalidates every other session immediately.
 */

export const SESSION_COOKIE = 'moyo_session';
export const CSRF_COOKIE = 'moyo_csrf';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  isActive: boolean;
  providerId: string | null;
  technicianId: string | null;
};

function getClientIp(): string {
  const h = headers();
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? '';
  return h.get('x-real-ip') ?? 'unknown';
}

export async function createSession(userId: string): Promise<{ token: string; csrf: string }> {
  const h = headers();
  const token = generateToken();
  const csrf = generateToken(24);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      csrfToken: csrf,
      expiresAt,
      userAgent: (h.get('user-agent') ?? '').slice(0, 255),
      ipHash: hashIp(getClientIp()),
    },
  });

  return { token, csrf };
}

/**
 * Cookie options. HttpOnly keeps the token away from JS (XSS cannot read it),
 * SameSite=Lax blocks cross-site POSTs, and Secure is required in production.
 */
export function sessionCookieOptions(maxAgeMs = SESSION_TTL_MS) {
  return {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

export function csrfCookieOptions() {
  return {
    // Readable by the client so it can be echoed in the x-csrf-token header.
    httpOnly: false,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/** Revokes the current session (logout). Idempotent. */
export async function destroySession(): Promise<void> {
  const jar = cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}

/** Revokes every session for a user (password change, "sign out everywhere"). */
export async function destroyAllSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  const jar = cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}

/**
 * Resolves the current session user. Memoized per request via React `cache`,
 * so a page and its nested components do not re-query repeatedly.
 *
 * Returns null when absent, expired, revoked, or the account is inactive.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { provider: true, technician: true } } },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (!session.user.isActive) return null;

  const { user } = session;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    providerId: user.provider?.id ?? null,
    technicianId: user.technician?.id ?? null,
  };
});

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Requires any authenticated user; throws 401 otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError('Authentication required', 401);
  return user;
}

/** Requires one of the given roles. Used by every admin route and API. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw new AuthError('You do not have access to this resource', 403);
  }
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  return requireRole('ADMIN');
}

/**
 * Verifies the double-submit CSRF token for the current session.
 * Called from every mutating API route.
 */
export async function assertCsrf(request: Request): Promise<void> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) throw new AuthError('Authentication required', 401);

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    select: { csrfToken: true, revokedAt: true, expiresAt: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new AuthError('Session expired', 401);
  }

  const provided = request.headers.get('x-csrf-token');
  if (!provided || provided !== session.csrfToken) {
    throw new AuthError('Invalid CSRF token', 403);
  }
}

/**
 * Origin check as defence-in-depth behind CSRF tokens.
 * Rejects requests whose Origin does not match the configured app URL.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return; // same-origin requests may omit Origin
  const allowed = new URL(env().APP_URL).origin;
  if (origin !== allowed) {
    throw new AuthError('Cross-origin request rejected', 403);
  }
}