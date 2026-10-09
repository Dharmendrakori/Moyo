import {
  apiHandler,
  badRequest,
  jsonOk,
  parseJson,
  tooManyRequests,
  unauthorized,
} from '@/lib/api';
import { assertCsrf, assertSameOrigin, getCurrentUser } from '@/lib/auth';
import { PROFILE_POLICY, rateLimitByUser } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';
import { updateAddressSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';

/**
 * PUT /api/account/address
 *
 * Creates or updates the signed-in user's OWN saved address. The row is
 * located via the session user id (`userId: user.id`) - the browser never
 * supplies a user id or an address id, so one user can never touch another's
 * address. Only explicitly allowed columns are written.
 */
export const PUT = apiHandler(async (request: Request) => {
  assertSameOrigin(request);

  const user = await getCurrentUser();
  if (!user) throw unauthorized();

  const limit = await rateLimitByUser(PROFILE_POLICY, user.id);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  await assertCsrf(request);

  const body = await parseJson(request, updateAddressSchema);

  const existing = await prisma.customerAddress.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  const data = {
    ...(body.label !== undefined ? { label: body.label } : {}),
    ...(body.line1 !== undefined ? { line1: body.line1 } : {}),
    ...(body.line2 !== undefined
      ? { line2: body.line2 === '' ? null : body.line2 }
      : {}),
    ...(body.landmark !== undefined
      ? { landmark: body.landmark === '' ? null : body.landmark }
      : {}),
    ...(body.area !== undefined ? { area: body.area } : {}),
    ...(body.city !== undefined ? { city: body.city } : {}),
    ...(body.state !== undefined ? { state: body.state } : {}),
    ...(body.pincode !== undefined ? { pincode: body.pincode } : {}),
  };

  // A first-time save with only a fragment would persist an unusable address
  // (empty required columns). Validate BEFORE writing.
  if (
    !existing &&
    (!body.line1 || !body.area || !body.city || !body.state || !body.pincode)
  ) {
    throw badRequest('Enter the full address: line 1, area, city, state and PIN code.');
  }

  const address = existing
    ? await prisma.customerAddress.update({ where: { userId: user.id }, data })
    : await prisma.customerAddress.create({
        data: {
          userId: user.id,
          label: body.label ?? 'Home',
          line1: body.line1 ?? '',
          line2: body.line2 === '' ? null : (body.line2 ?? null),
          landmark: body.landmark === '' ? null : (body.landmark ?? null),
          area: body.area ?? '',
          city: body.city ?? '',
          state: body.state ?? '',
          pincode: body.pincode ?? '',
        },
      });

  await audit({
    action: 'USER_UPDATED',
    entityType: 'CustomerAddress',
    entityId: address.id,
    actorId: user.id,
    actorRole: user.role,
    metadata: { via: 'account_page' },
  });

  return jsonOk({
    address: {
      label: address.label,
      line1: address.line1,
      line2: address.line2,
      landmark: address.landmark,
      area: address.area,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
    },
  });
});
