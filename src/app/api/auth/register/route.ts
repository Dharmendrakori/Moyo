import { cookies } from 'next/headers';
import { audit } from '@/lib/audit';
import { hashPassword } from '@/lib/crypto';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  assertSameOrigin,
  createSession,
  csrfCookieOptions,
  sessionCookieOptions,
} from '@/lib/auth';
import { apiHandler, jsonError, jsonOk, parseJson, tooManyRequests } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { REGISTER_POLICY, rateLimitByIp } from '@/lib/rate-limit';
import { registerSchema } from '@/lib/validation';
import { resolvePostLoginRedirect } from '@/lib/redirect';

/**
 * POST /api/auth/register
 *
 * Self-service registration always creates a CUSTOMER. There is deliberately no
 * `role` field in the request body - a client must never be able to choose its
 * own privilege level (privilege escalation defence).
 */
export const POST = apiHandler(async (request: Request) => {
  assertSameOrigin(request);

  const limit = await rateLimitByIp(REGISTER_POLICY);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const body = await parseJson(request, registerSchema);

  // Check for an existing account on either identifier.
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: body.email }, { phone: body.phone }] },
    select: { id: true },
  });
  if (existing) {
    return jsonError(
      'ACCOUNT_EXISTS',
      'An account already exists with this email address or mobile number.',
      409,
    );
  }

  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email,
      phone: body.phone,
      passwordHash: await hashPassword(body.password),
      // Hard-coded. Never taken from the request.
      role: 'CUSTOMER',
    },
    select: { id: true, name: true, email: true, phone: true },
  });

  // Optional referral linkage. The code is validated by lookup, never trusted.
  if (body.referralCode) {
    const referral = await prisma.referral.findFirst({
      where: { code: body.referralCode.toUpperCase(), inviteeId: null },
      select: { id: true, ownerId: true },
    });
    if (referral && referral.ownerId !== user.id) {
      await prisma.referral.update({
        where: { id: referral.id },
        data: { inviteeId: user.id, status: 'QUALIFIED' },
      });
    }
  }

  // Auto sign-in after registration.
  const { token, csrf } = await createSession(user.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions());
  jar.set(CSRF_COOKIE, csrf, csrfCookieOptions());

  await audit({
    action: 'USER_CREATED',
    entityType: 'User',
    entityId: user.id,
    actorId: user.id,
    actorRole: 'CUSTOMER',
    metadata: { via: 'self_registration' },
  });

  // `next` is validated to be a same-origin relative path (open-redirect guard),
  // mirroring the login route. Self-registered accounts are always CUSTOMER,
  // so the role here is hard-coded, never taken from the request.
  const requested = new URL(request.url).searchParams.get('next');

  return jsonOk(
    { user, redirectTo: resolvePostLoginRedirect(requested, 'CUSTOMER'), csrfToken: csrf },
    { status: 201 },
  );
});