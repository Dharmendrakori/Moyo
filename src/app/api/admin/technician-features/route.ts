import { adminReadGuard, adminWriteGuard, asAdminActor } from '@/lib/admin-api';
import { apiHandler, jsonOk, parseJson } from '@/lib/api';
import { technicianFeaturesSchema } from '@/lib/validation';
import { getTechnicianFeatures, setTechnicianFeatures } from '@/lib/technician-features';

/**
 * TECHNICIAN FEATURE CONFIGURATION
 *
 * GET   /api/admin/technician-features  - current flags
 * PATCH /api/admin/technician-features  - change one or both
 *
 * These are the ONLY two settings in this model; there is no generic key/value
 * endpoint and no way to introduce a new key at runtime.
 *
 * PATCH is deliberately NOT gated by `adminManagementEnabled`: it is the switch
 * itself, and hiding it behind its own off state would leave an operator unable
 * to turn management back on without database access.
 *
 * Every change is audited with the previous and new values, and switching the
 * portal off revokes live technician sessions inside `setTechnicianFeatures`.
 */
export const GET = apiHandler(async (request: Request) => {
  const guard = await adminReadGuard(request);
  if (!guard.ok) return guard.response;

  const features = await getTechnicianFeatures();
  return jsonOk({ features });
});

export const PATCH = apiHandler(async (request: Request) => {
  const guard = await adminWriteGuard(request);
  if (!guard.ok) return guard.response;

  const body = await parseJson(request, technicianFeaturesSchema);
  const result = await setTechnicianFeatures(body, asAdminActor(guard.user));

  return jsonOk({ features: result.current, revokedSessions: result.revokedSessions });
});
