import { apiHandler, jsonOk, notFound, parseJson } from '@/lib/api';
import { asAdminActor, adminReadGuard, adminWriteGuard, readIdParam } from '@/lib/admin-api';
import {
  countServiceQuotedBookings,
  getAdminService,
  setServiceActive,
} from '@/lib/admin-catalog';
import { adminServiceStatusSchema } from '@/lib/validation';

/**
 * GET /api/admin/services/:id
 *
 * One service with its charging-option configuration and a count of the
 * bookings that currently carry a fixed quote for it.
 *
 * That count exists so the operator is warned BEFORE re-pricing. It is a read
 * only; publishing a new price never rewrites any of those bookings.
 */
export const GET = apiHandler(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const guard = await adminReadGuard(request);
  if (!guard.ok) return guard.response;

  const id = await readIdParam(context.params);

  const service = await getAdminService(id);
  if (!service) throw notFound('Service');

  const quotedBookings = await countServiceQuotedBookings(id);
  return jsonOk({ service, quotedBookings });
});

/**
 * PATCH /api/admin/services/:id
 *
 * Activates or deactivates one service.
 *
 * ONLY `isActive` IS WRITABLE. Name, slug, serviceType and catalogue placement
 * are absent from the `.strict()` schema, so they cannot be mass-assigned. A
 * deactivated service disappears from the customer catalogue and becomes
 * unbookable (both `listCategories` and the booking route filter on
 * `isActive: true`), but its row and all of its booking history remain intact.
 */
export const PATCH = apiHandler(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const guard = await adminWriteGuard(request);
  if (!guard.ok) return guard.response;

  const id = await readIdParam(context.params);
  const body = await parseJson(request, adminServiceStatusSchema);

  const service = await setServiceActive(id, body.isActive, asAdminActor(guard.user));
  return jsonOk({ service });
});
