import { adminWriteGuard, asAdminActor, readIdParam } from '@/lib/admin-api';
import { apiHandler, jsonOk, parseJson } from '@/lib/api';
import { adminTechnicianUpdateSchema } from '@/lib/validation';
import { assertTechnicianAdminManagementEnabled } from '@/lib/technician-features';
import { updateTechnicianProfile } from '@/lib/technicians';

/**
 * PATCH /api/admin/technicians/[id]
 *
 * Roster edits: name, headline, skills, service areas, phone, activation state
 * and availability. The target row comes from the URL path (never the body), is
 * re-read from the database before the write, and `userId` / `providerId` /
 * rating columns are not part of the schema, so a body cannot repoint a profile
 * at another account or provider.
 *
 * Deactivation is consequential - it also disables the linked login and revokes
 * that technician's live portal sessions - so it is audited as its own event in
 * addition to the profile update.
 */
export const PATCH = apiHandler(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const guard = await adminWriteGuard(request);
    if (!guard.ok) return guard.response;

    await assertTechnicianAdminManagementEnabled();

    const id = await readIdParam(context.params);
    const body = await parseJson(request, adminTechnicianUpdateSchema);

    const technician = await updateTechnicianProfile(id, body, asAdminActor(guard.user));

    return jsonOk({ technician });
  },
);
