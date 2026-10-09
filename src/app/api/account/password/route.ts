import { audit } from '@/lib/audit';
import {
  apiHandler,
  jsonError,
  jsonOk,
  parseJson,
  tooManyRequests,
  unauthorized,
} from '@/lib/api';
import {
  assertCsrf,
  assertSameOrigin,
  destroyAllSessions,
  getCurrentUser,
} from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/crypto';
import { prisma } from '@/lib/prisma';
import { PASSWORD_CHANGE_POLICY, rateLimitByUser } from '@/lib/rate-limit';
import { changePasswordSchema } from '@/lib/validation';

/**
 * POST /api/account/password
 *
 * Authenticated password change. Baseline identity verification is the
 * CURRENT password, checked with bcrypt against the stored hash.
 *
 * Guard chain (mirrors the admin write chain):
 *   assertSameOrigin -> require session -> per-account rate limit ->
 *   assertCsrf -> strict Zod parse -> bcrypt verify current -> bcrypt hash
 *   new -> update + revoke ALL sessions -> audit (no secrets).
 *
 * On success every session for the account - including the current one - is
 * revoked and the cookies are cleared, so the user MUST sign in again with
 * the new password. Previously issued tokens never survive a credential
 * change. Nothing secret is logged, audited, or echoed: no passwords, no
 * hashes, no request bodies.
 */
export const POST = apiHandler(async (request: Request) => {
  assertSameOrigin(request);

  const user = await getCurrentUser();
  if (!user) throw unauthorized();

  const limit = await rateLimitByUser(PASSWORD_CHANGE_POLICY, user.id);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  await assertCsrf(request);

  const body = await parseJson(request, changePasswordSchema);

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, passwordHash: true, isActive: true },
  });

  if (!record || !record.isActive) {
    // Generic failure: indistinguishable from a wrong password.
    return jsonError('INVALID_CREDENTIALS', 'Your current password is incorrect.', 401);
  }

  const currentOk = await verifyPassword(body.currentPassword, record.passwordHash);
  if (!currentOk) {
    await audit({
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      metadata: { reason: 'password_change_current_mismatch' },
    });
    return jsonError('INVALID_CREDENTIALS', 'Your current password is incorrect.', 401);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(body.newPassword),
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  // Revoke every session (current included) and clear this browser's cookies.
  await destroyAllSessions(user.id);

  await audit({
    action: 'PASSWORD_CHANGED',
    entityType: 'User',
    entityId: user.id,
    actorId: user.id,
    actorRole: user.role,
  });

  return jsonOk({ ok: true, requireRelogin: true });
});
