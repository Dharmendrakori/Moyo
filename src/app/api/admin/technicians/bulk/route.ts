import { adminWriteGuard, asAdminActor } from '@/lib/admin-api';
import { apiHandler, jsonOk, parseJson } from '@/lib/api';
import { adminTechnicianBulkSchema } from '@/lib/validation';
import { assertTechnicianAdminManagementEnabled } from '@/lib/technician-features';
import { bulkUpdateTechnicians } from '@/lib/technicians';

/**
 * POST /api/admin/technicians/bulk
 *
 * One endpoint for every multi-technician operation, discriminated by `action`.
 * A single boundary keeps the security chain identical for all of them:
 * `adminWriteGuard` proves a live ADMIN session, verifies the CSRF token and the
 * Origin, and rate-limits - before the body is parsed. The feature switch is then
 * enforced, so bulk management is unavailable exactly when single-record
 * management is.
 *
 * The body is `.strict()` and bounded: ids must be cuids, duplicates are rejected,
 * the batch is capped at 50, and only the value-bearing actions may carry values.
 * No client-supplied attribute is trusted - the server re-reads every row and
 * applies the change itself.
 *
 * REFUSED BY DESIGN (nothing is written):
 *  - deactivating a technician who still has open work (`409 ACTIVE_ASSIGNMENTS`);
 *  - any operation while technician management is switched off;
 *  - invitations for accounts that were already activated (no reset exists).
 *
 * The response is `private, no-store` because a re-issue returns one-time
 * activation paths for the operator to hand over; they are never logged, audited
 * or cached.
 */
export const POST = apiHandler(async (request: Request) => {
  const guard = await adminWriteGuard(request);
  if (!guard.ok) return guard.response;

  await assertTechnicianAdminManagementEnabled();

  const body = await parseJson(request, adminTechnicianBulkSchema);
  const result = await bulkUpdateTechnicians(body, asAdminActor(guard.user));

  return jsonOk({ action: body.action, result });
});
