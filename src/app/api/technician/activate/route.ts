import { audit } from '@/lib/audit';
import { assertSameOrigin } from '@/lib/auth';
import { ApiError, apiHandler, jsonError, jsonOk, parseJson, tooManyRequests } from '@/lib/api';
import { hashPassword, sha256 } from '@/lib/crypto';
import { prisma } from '@/lib/prisma';
import { LOGIN_POLICY, rateLimitByIp } from '@/lib/rate-limit';
import { technicianActivateSchema } from '@/lib/validation';
import { getTechnicianFeatures } from '@/lib/technician-features';

/**
 * POST /api/technician/activate
 *
 * The technician proves possession of the one-time invitation token and chooses
 * their OWN password. No administrator ever knows or sets that password, and no
 * default password exists anywhere in this codebase.
 *
 * WHY A TOKEN INSTEAD OF AN INVITATION EMAIL: this application has no mail
 * delivery and no password-reset flow (see SECURITY.md). Rather than invent a
 * weaker substitute - an admin-chosen password, or a predictable initial one -
 * the operator is given a single-use link to hand over out of band. Only the
 * SHA-256 hash of the token is stored, it expires, and it is cleared on first
 * successful use.
 *
 * The endpoint is unauthenticated by design (the token IS the credential), so it
 * carries the full public-endpoint guard set: same-origin, IP rate limit, feature
 * check, strict body, and a single generic failure message for every negative
 * outcome so it cannot be used to probe which tokens or accounts exist.
 */
export const POST = apiHandler(async (request: Request) => {
  assertSameOrigin(request);

  const limit = await rateLimitByIp(LOGIN_POLICY);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const features = await getTechnicianFeatures();
  if (!features.portalEnabled) {
    throw new ApiError('PORTAL_DISABLED', 'The technician portal is not available.', 403);
  }

  const body = await parseJson(request, technicianActivateSchema);

  const invalid = jsonError(
    'ACTIVATION_INVALID',
    'This activation link is invalid or has expired. Ask your administrator for a new one.',
    400,
  );

  const tokenHash = sha256(body.token);
  const user = await prisma.user.findFirst({
    where: { activationTokenHash: tokenHash },
    select: {
      id: true,
      role: true,
      isActive: true,
      activationExpiresAt: true,
      technician: { select: { id: true, isActive: true } },
    },
  });

  // Every negative outcome answers identically: a wrong token, a non-technician
  // account, a deactivated profile and an expired invitation are indistinguishable.
  if (!user || user.role !== 'TECHNICIAN') return invalid;

  if (!user.isActive || !user.technician || !user.technician.isActive) {
    await audit({
      action: 'ACCESS_DENIED',
      entityType: 'User',
      entityId: user.id,
      metadata: { reason: 'activation_account_inactive' },
    });
    return invalid;
  }

  if (!user.activationExpiresAt || user.activationExpiresAt < new Date()) {
    await audit({
      action: 'ACCESS_DENIED',
      entityType: 'User',
      entityId: user.id,
      metadata: { reason: 'activation_expired' },
    });
    return invalid;
  }

  const passwordHash = await hashPassword(body.password);

  // Conditional on the same token hash, so two concurrent requests cannot both
  // consume the invitation: exactly one wins, the other is rejected.
  const claimed = await prisma.user.updateMany({
    where: { id: user.id, activationTokenHash: tokenHash },
    data: {
      passwordHash,
      activationTokenHash: null,
      activationExpiresAt: null,
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  if (claimed.count !== 1) return invalid;

  // Nothing else may keep a session minted before the account was activated.
  await prisma.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await audit({
    action: 'TECHNICIAN_ACCOUNT_ACTIVATED',
    entityType: 'User',
    entityId: user.id,
    actorId: user.id,
    actorRole: 'TECHNICIAN',
  });

  // Deliberately no session is created here: the technician signs in normally,
  // so the login path (rate limiting, lockout, session fixation defence) is the
  // only way a session is ever minted.
  return jsonOk({ redirectTo: '/technician/login?activated=1' });
});
