import { audit } from '@/lib/audit';
import { hashPassword } from '@/lib/crypto';
import { assertSameOrigin } from '@/lib/auth';
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

  await audit({
    action: 'USER_CREATED',
    entityType: 'User',
    entityId: user.id,
    actorId: user.id,
    actorRole: 'CUSTOMER',
    metadata: { via: 'self_registration' },
  });

  // Registration deliberately does NOT create an authenticated session. The new
  // account must sign in explicitly, so the browser is sent to `/login` with a
  // `registered` flag for the success message. A safe, explicitly requested
  // `next` is preserved through that hop and applied only after a real login,
  // re-authorized against the server-resolved role. It is validated by
  // `resolvePostLoginRedirect` below - never trusted - and only ever a local
  // path, so no credentials or tokens are placed in the URL.
  const requested = new URL(request.url).searchParams.get('next');
  const afterLogin = resolvePostLoginRedirect(requested, 'CUSTOMER');
  const redirectTo =
    afterLogin === '/' ? '/login?registered=1' : `/login?registered=1&next=${encodeURIComponent(afterLogin)}`;

  return jsonOk({ user, redirectTo }, { status: 201 });
});