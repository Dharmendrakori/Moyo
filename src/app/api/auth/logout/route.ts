import { cookies } from 'next/headers';
import { audit } from '@/lib/audit';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  assertCsrf,
  assertSameOrigin,
  csrfCookieOptions,
  destroyAllSessions,
  destroySession,
  getCurrentUser,
  sessionCookieOptions,
} from '@/lib/auth';
import { apiHandler, jsonOk } from '@/lib/api';

/**
 * POST /api/auth/logout
 *
 * Requires a valid CSRF token so a third-party site cannot force a logout.
 * Revokes the session row server-side, then clears the cookies.
 */
export const POST = apiHandler(async (request: Request) => {
  assertSameOrigin(request);
  await assertCsrf(request);

  const user = await getCurrentUser();
  await destroySession();

  if (user) {
    await audit({
      action: 'LOGOUT',
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      actorRole: user.role,
    });
  }

  return jsonOk({ ok: true });
});

/**
 * DELETE /api/auth/logout-all
 *
 * Revokes every session for the account ("sign out everywhere"), which is the
 * safe response to a suspected session theft.
 */
export const DELETE = apiHandler(async (request: Request) => {
  assertSameOrigin(request);

  const user = await getCurrentUser();
  if (!user) {
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
    jar.delete(CSRF_COOKIE);
    return jsonOk({ ok: true });
  }

  await assertCsrf(request);
  await destroyAllSessions(user.id);

  await audit({
    action: 'LOGOUT_ALL',
    entityType: 'User',
    entityId: user.id,
    actorId: user.id,
    actorRole: user.role,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, '', sessionCookieOptions(0));
  jar.set(CSRF_COOKIE, '', csrfCookieOptions());

  return jsonOk({ ok: true });
});