import { apiHandler, jsonOk, parseJson } from '@/lib/api';
import { asAdminActor, adminWriteGuard } from '@/lib/admin-api';
import {
  bulkDeleteServices,
  bulkEditServices,
  bulkSetServiceActive,
} from '@/lib/admin-catalog';
import { adminServiceBulkSchema } from '@/lib/validation';

/**
 * POST /api/admin/services/bulk
 *
 * One endpoint for every multi-service operation - activate, deactivate, edit
 * and delete - discriminated by `action`. A single boundary keeps the security
 * chain identical for all four: `adminWriteGuard` proves a live ADMIN session,
 * verifies the CSRF token and Origin, and rate-limits before the body is even
 * parsed.
 *
 * The `.strict()` schema validates every submitted id (cuid) and the edit patch,
 * and caps the batch, so an oversized or malformed request is rejected here and
 * never reaches the database. The server then re-reads each row and applies the
 * change; DELETE refuses to remove any service referenced by a booking and
 * reports it back rather than failing silently.
 *
 * The response carries per-operation detail (how many were affected, which ids
 * were not found, which were protected or skipped) so the console can show an
 * honest partial-failure summary instead of a vague "done".
 */
export const POST = apiHandler(async (request: Request) => {
  const guard = await adminWriteGuard(request);
  if (!guard.ok) return guard.response;

  const body = await parseJson(request, adminServiceBulkSchema);
  const actor = asAdminActor(guard.user);

  let result;
  switch (body.action) {
    case 'ACTIVATE':
    case 'DEACTIVATE':
      result = await bulkSetServiceActive(body, actor);
      break;
    case 'EDIT':
      result = await bulkEditServices(body, actor);
      break;
    case 'DELETE':
      result = await bulkDeleteServices(body, actor);
      break;
  }

  return jsonOk({ action: body.action, result });
});
