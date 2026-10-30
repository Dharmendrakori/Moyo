import 'server-only';
import { assertCsrf, assertSameOrigin, requireAdmin, type SessionUser } from './auth';
import { notFound, tooManyRequests } from './api';
import { ADMIN_MUTATION_POLICY, READ_POLICY, rateLimitByUser } from './rate-limit';

/**
 * ADMIN ROUTE GUARD
 *
 * ONE place where the admin security boundary is defined, so it cannot drift
 * between endpoints. Every route under `/api/admin/**` and every admin page
 * goes through this; there is no admin route that authorises itself any other
 * way.
 *
 * WHAT THE CHAIN ACTUALLY PROVES:
 *
 *   assertSameOrigin  -> the request was not initiated cross-site
 *   requireAdmin      -> a live, unrevoked, unexpired session exists AND the
 *                        role stored in the database is exactly ADMIN
 *   assertCsrf        -> the caller holds this session's CSRF token, so another
 *                        origin cannot drive a mutation with a borrowed cookie
 *   rateLimit         -> a scripted or compromised operator cannot hammer the
 *                        commercial endpoints
 *
 * The order matters and is deliberate: authorization is checked BEFORE any body
 * is parsed or any database write is attempted, so an unauthorized caller can
 * never reach application logic, let alone mutate data.
 *
 * Hiding a link in React is NOT part of this chain and never could be. The
 * role is read from the database on every request via `getCurrentUser`, so a
 * demotion or a logout takes effect on the very next call - there is no JWT
 * that could keep a stale claim alive.
 */

export type Guarded =
  | { ok: true; user: SessionUser }
  | { ok: false; response: Response };

/** Guard for a read-only admin endpoint. */
export async function adminReadGuard(request: Request): Promise<Guarded> {
  assertSameOrigin(request);

  // Throws AuthError(401) when there is no session and AuthError(403) when the
  // session belongs to a CUSTOMER, PROVIDER or TECHNICIAN. `apiHandler` maps
  // those to UNAUTHENTICATED / FORBIDDEN without leaking any detail.
  const user = await requireAdmin();

  const limit = await rateLimitByUser(READ_POLICY, user.id);
  if (!limit.allowed) return { ok: false, response: tooManyRequests(limit.retryAfterSeconds) };

  return { ok: true, user };
}

/**
 * Guard for a mutating admin endpoint.
 *
 * CSRF is verified here, after the role has already been established, so a
 * non-admin request is rejected as UNAUTHENTICATED/FORBIDDEN rather than
 * leaking whether its CSRF token was also wrong.
 */
export async function adminWriteGuard(request: Request): Promise<Guarded> {
  assertSameOrigin(request);

  const user = await requireAdmin();
  await assertCsrf(request);

  const limit = await rateLimitByUser(ADMIN_MUTATION_POLICY, user.id);
  if (!limit.allowed) return { ok: false, response: tooManyRequests(limit.retryAfterSeconds) };

  return { ok: true, user };
}

/**
 * Narrows the session user to the actor shape the catalog and booking write
 * models expect.
 *
 * `requireAdmin()` has already proven the role is ADMIN; this re-states it in
 * the type so a future refactor cannot pass an arbitrary role into a write.
 * An administrator owns no provider or technician record, so both scopes are
 * explicitly null - `ownershipWhere()` reads ADMIN first and returns the bare
 * `{ id }` scope, so these values never widen access.
 */
export function asAdminActor(user: SessionUser) {
  return { id: user.id, role: 'ADMIN' as const, providerId: null, technicianId: null };
}

/**
 * Validates a dynamic route id before it reaches Prisma.
 *
 * Ids are cuid. Rejecting a malformed id at the boundary means a junk id can
 * never become a database lookup, and keeps the "not found" response for a
 * malformed id identical to the one for a real-but-missing id.
 */
export async function readIdParam(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  if (typeof id !== 'string' || !/^c[a-z0-9]{20,30}$/.test(id)) {
    throw notFound('Record');
  }
  return id;
}
