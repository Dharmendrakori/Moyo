import { apiHandler, jsonOk, parseJson } from '@/lib/api';
import { asAdminActor, adminWriteGuard } from '@/lib/admin-api';
import { bulkSetCategoryActive } from '@/lib/admin-catalog';
import { adminCategoryBulkSchema } from '@/lib/validation';

/**
 * POST /api/admin/categories/bulk
 *
 * Activates or deactivates several official categories at once.
 *
 * The `.strict()` schema allows ONLY an `action` of ACTIVATE/DEACTIVATE plus the
 * id list. Name, code and position are absent, so a bulk call can never rename,
 * reorder or - critically - DELETE an official category; those identities are
 * preserved exactly as specified. `adminWriteGuard` enforces the ADMIN session,
 * CSRF, Origin and rate limiting before the body is parsed.
 */
export const POST = apiHandler(async (request: Request) => {
  const guard = await adminWriteGuard(request);
  if (!guard.ok) return guard.response;

  const body = await parseJson(request, adminCategoryBulkSchema);
  const result = await bulkSetCategoryActive(body, asAdminActor(guard.user));

  return jsonOk({ action: body.action, result });
});
