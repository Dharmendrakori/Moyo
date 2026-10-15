import { apiHandler, jsonOk, parseJson } from '@/lib/api';
import { asAdminActor, adminWriteGuard } from '@/lib/admin-api';
import { bulkSetChargingOptionActive } from '@/lib/admin-catalog';
import { adminChargingBulkSchema } from '@/lib/validation';

/**
 * POST /api/admin/charging-options/bulk
 *
 * Enables or disables ONE charging type - Visit Charge, Fixed Charge or
 * Customer Budget - across several services at once.
 *
 * The `.strict()` schema allows only `ids`, `charging` and an ENABLE/DISABLE
 * `action`. Price, budget bounds and duration are absent from the contract, so
 * a bulk call can never publish a price or rewrite a range; only `isActive` of
 * the named charging type is written, and the write model filters on that
 * type, so the other two options of every selected service are untouched.
 * `adminWriteGuard` proves a live ADMIN session, verifies CSRF and Origin, and
 * rate-limits before the body is even parsed.
 *
 * The response carries per-service detail - how many were affected, which ids
 * no longer exist, and which services were skipped with the reason (e.g.
 * Customer Budget with no configured range) - so the console can show an
 * honest partial-failure summary instead of a vague "done".
 */
export const POST = apiHandler(async (request: Request) => {
  const guard = await adminWriteGuard(request);
  if (!guard.ok) return guard.response;

  const body = await parseJson(request, adminChargingBulkSchema);
  const result = await bulkSetChargingOptionActive(body, asAdminActor(guard.user));

  return jsonOk({ action: body.action, charging: body.charging, result });
});