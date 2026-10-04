import { apiHandler, jsonOk } from '@/lib/api';
import { adminReadGuard } from '@/lib/admin-api';
import { listAdminChargingOptions } from '@/lib/admin-catalog';

/**
 * GET /api/admin/charging-options
 *
 * Every `ServiceOption` row with its service and category context.
 *
 * The three official charging concepts - Visit Charge, Fixed Charge and Customer
 * Budget - are the values the domain model already defines in
 * `src/lib/domain.ts`. They are read from the database; this endpoint does not
 * invent, reorder or extend them, and it never returns a price the provider
 * has not published.
 */
export const GET = apiHandler(async (request: Request) => {
  const guard = await adminReadGuard(request);
  if (!guard.ok) return guard.response;

  const options = await listAdminChargingOptions();
  return jsonOk({ options, total: options.length });
});
