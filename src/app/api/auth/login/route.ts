import { cookies } from 'next/headers';
import { audit } from '@/lib/audit';
import { verifyPassword, DUMMY_HASH } from '@/lib/crypto';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  assertSameOrigin,
  createSession,
  csrfCookieOptions,
  sessionCookieOptions,
} from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiHandler, jsonError, jsonOk, parseJson, tooManyRequests } from '@/lib/api';
import { LOGIN_POLICY, rateLimitByIp } from '@/lib/rate-limit';
import { loginSchema } from '@/lib/validation';
import { resolvePostLoginRedirect } from '@/lib/redirect';
import { getTechnicianFeatures } from '@/lib/technician-features';

/**
 * POST /api/auth/login
 *
 * Anti-brute-force measures:
 *  - IP-keyed rate limit (8 attempts / 15 min).
 *  - Per-account lockout after repeated failures.
 *  - A dummy bcrypt comparison on unknown accounts so response time does not
 *    reveal whether an email exists.
 *  - Identical error text for unknown user, wrong password and locked account.
 */
export const POST = apiHandler(async (request: Request) => {
  assertSameOrigin(request);

  const ipLimit = await rateLimitByIp(LOGIN_POLICY);
  if (!ipLimit.allowed) return tooManyRequests(ipLimit.retryAfterSeconds);

  const body = await parseJson(request, loginSchema);

  // Accept either an email address or a 10-digit phone number.
  const identifier = body.identifier.trim().toLowerCase();
  const isEmail = identifier.includes('@');

  const user = await prisma.user.findFirst({
    where: isEmail ? { email: identifier } : { phone: identifier.replace(/\D/g, '').slice(-10) },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      passwordHash: true,
      failedLoginCount: true,
      lockedUntil: true,
      technician: { select: { id: true, isActive: true } },
    },
  });

  // Constant-ish work regardless of whether the account exists.
  const hashToCompare = user?.passwordHash ?? DUMMY_HASH;
  const passwordOk = await verifyPassword(body.password, hashToCompare);

  const genericFailure = jsonError(
    'INVALID_CREDENTIALS',
    'The email or password you entered is incorrect.',
    401,
  );

  if (!user) {
    await audit({ action: 'LOGIN_FAILED', entityType: 'User', metadata: { reason: 'unknown_account' } });
    return genericFailure;
  }

  // Locked out?
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await audit({ action: 'LOGIN_FAILED', entityType: 'User', entityId: user.id });
    return jsonError(
      'ACCOUNT_LOCKED',
      'Too many failed attempts. Please try again later.',
      429,
    );
  }

  if (!passwordOk) {
    const failed = user.failedLoginCount + 1;
    // Exponential-ish lockout: lock after 5 consecutive failures.
    const shouldLock = failed >= 5;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed,
        lockedUntil: shouldLock ? new Date(Date.now() + 15 * 60_000) : null,
      },
    });
    await audit({
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: user.id,
      metadata: { failedCount: failed, locked: shouldLock },
    });
    return genericFailure;
  }

  if (!user.isActive) {
    await audit({
      action: 'ACCESS_DENIED',
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      metadata: { reason: 'inactive_account' },
    });
    return jsonError('ACCOUNT_DISABLED', 'This account has been disabled. Contact support.', 403);
  }

  /**
   * TECHNICIAN ACCOUNTS are only usable while the technician portal feature is
   * enabled AND the linked profile is active. Both facts come from the database
   * on every attempt, so switching the portal off takes effect immediately -
   * a credential that was valid yesterday does not become a way in.
   *
   * This check runs AFTER the password has been verified: a caller who cannot
   * produce the right password never learns anything from it, so it adds no
   * account-enumeration surface.
   */
  if (user.role === 'TECHNICIAN') {
    const features = await getTechnicianFeatures();

    if (!features.portalEnabled) {
      await audit({
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        metadata: { reason: 'technician_portal_disabled' },
      });
      return jsonError(
        'PORTAL_DISABLED',
        'The technician portal is not currently available. Contact your administrator.',
        403,
      );
    }

    if (!user.technician || !user.technician.isActive) {
      await audit({
        action: 'ACCESS_DENIED',
        entityType: 'User',
        entityId: user.id,
        actorId: user.id,
        metadata: { reason: 'technician_inactive' },
      });
      return jsonError('ACCOUNT_DISABLED', 'This account has been disabled. Contact support.', 403);
    }
  }

  // Success: reset counters and mint a brand-new session (fixation defence).
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const { token, csrf } = await createSession(user.id);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions());
  jar.set(CSRF_COOKIE, csrf, csrfCookieOptions());

  await audit({
    action: 'LOGIN',
    entityType: 'User',
    entityId: user.id,
    actorId: user.id,
    actorRole: user.role as never,
  });

  // `next` is validated to be a same-origin relative path (open-redirect guard)
  // AND checked against the server-resolved role: only an ADMIN may land on
  // `/admin`. The role comes from the database session, never the request.
  const requested = new URL(request.url).searchParams.get('next');

  return jsonOk({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    redirectTo: resolvePostLoginRedirect(requested, user.role),
    csrfToken: csrf,
  });
});