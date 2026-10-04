import { apiHandler, jsonOk, parseJson } from '@/lib/api';
import { asAdminActor, adminWriteGuard, readIdParam } from '@/lib/admin-api';
import { setChargingOption } from '@/lib/admin-catalog';
import { adminChargingOptionSchema } from '@/lib/validation';

/**
 * PATCH /api/admin/charging-options/:id
 *
 * Configures one charging option: whether the provider offers it, the customer
 * budget bounds for Customer Budget, and the expected duration.
 *
 * `pricePaise` IS DELIBERATELY NOT WRITABLE HERE. Enabling an option must never
 * be able to expose a price; publication is a separate, separately audited
 * action on /api/admin/pricing/:id. Budget bounds are additionally rejected
 * server-side on Visit Charge and Fixed Charge, because they carry no meaning
 * for those modes.
 */
export const PATCH = apiHandler(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const guard = await adminWriteGuard(request);
  if (!guard.ok) return guard.response;

  const id = await readIdParam(context.params);
  const body = await parseJson(request, adminChargingOptionSchema);

  const option = await setChargingOption(id, body, asAdminActor(guard.user));
  return jsonOk({ option });
});
