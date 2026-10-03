import { cookies } from 'next/headers';
import { CSRF_COOKIE, getCurrentUser } from '@/lib/auth';
import { apiHandler, jsonError, jsonOk } from '@/lib/api';

/**
 * GET /api/auth/csrf
 *
 * Returns the CURRENT session's CSRF token so a client can echo it in the
 * `x-csrf-token` header on mutating requests.
 *
 * The token is minted only when a session is created (login/register). This
 * route merely relays the existing one - it never generates fresh token
 * material, because issuing a new token here would let any same-origin script
 * obtain a valid token without proving prior authentication.
 */
export const GET = apiHandler(async () => {
  const user = await getCurrentUser();
  if (!user) return jsonError('UNAUTHENTICATED', 'Authentication required', 401);

  const jar = await cookies();
  const csrf = jar.get(CSRF_COOKIE)?.value;
  if (!csrf) return jsonError('CSRF_MISSING', 'No CSRF token available', 401);

  return jsonOk({ csrfToken: csrf });
});