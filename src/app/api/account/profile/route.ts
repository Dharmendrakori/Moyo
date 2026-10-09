import {
  apiHandler,
  conflict,
  jsonOk,
  parseJson,
  tooManyRequests,
  unauthorized,
} from '@/lib/api';
import {
  assertCsrf,
  assertSameOrigin,
  getCurrentUser,
} from '@/lib/auth';
import { PROFILE_POLICY, rateLimitByUser } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';
import { updateProfileSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';

/**
 * GET /api/account/profile
 *
 * Returns the signed-in user's OWN minimal profile. Identity comes from the
 * verified session - there is no user-id parameter, so one user can never
 * fetch another's record. Never returns password hashes, session tokens, or
 * internal auth metadata.
 */
export const GET = apiHandler(async () => {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();

  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      lastLoginAt: true,
      address: {
        select: {
          label: true,
          line1: true,
          line2: true,
          landmark: true,
          area: true,
          city: true,
          state: true,
          pincode: true,
        },
      },
    },
  });

  if (!profile) return jsonOk({ user: null }, { status: 404 });
  return jsonOk({ user: profile });
});

/**
 * PATCH /api/account/profile
 *
 * Updates the signed-in user's OWN permitted fields (name, phone).
 * `.strict()` schema rejects `role`, `email`, `isActive`, `passwordHash` and
 * every other privileged key. Email stays read-only: no verified
 * email-change flow exists.
 */
export const PATCH = apiHandler(async (request: Request) => {
  assertSameOrigin(request);

  const user = await getCurrentUser();
  if (!user) throw unauthorized();

  const limit = await rateLimitByUser(PROFILE_POLICY, user.id);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  // CSRF after auth+rate-limit, before body parsing (matches admin chain).
  await assertCsrf(request);

  const body = await parseJson(request, updateProfileSchema);

  // Phone numbers are unique: refuse one that belongs to another account with
  // a generic message that does not reveal which account holds it.
  if (body.phone !== undefined) {
    const holder = await prisma.user.findFirst({
      where: { phone: body.phone, id: { not: user.id } },
      select: { id: true },
    });
    if (holder) throw conflict('This mobile number is already in use.');
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
    },
    select: { id: true, name: true, email: true, phone: true, role: true },
  });

  await audit({
    action: 'USER_UPDATED',
    entityType: 'User',
    entityId: user.id,
    actorId: user.id,
    actorRole: user.role,
    metadata: {
      fields: [body.name !== undefined ? 'name' : null, body.phone !== undefined ? 'phone' : null]
        .filter(Boolean)
        .join(','),
    },
  });

  return jsonOk({ user: updated });
});
