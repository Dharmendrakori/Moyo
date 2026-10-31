import { adminWriteGuard, asAdminActor, readIdParam } from '@/lib/admin-api';
import { apiHandler, jsonOk, parseJson } from '@/lib/api';
import { adminTechnicianAccountSchema } from '@/lib/validation';
import { assertTechnicianAdminManagementEnabled } from '@/lib/technician-features';
import { provisionTechnicianAccount } from '@/lib/technicians';

/**
 * POST /api/admin/technicians/[id]/account
 *
 * Provisions a portal login for a roster profile that does not have one.
 *
 * This is the bridge between the feature combinations: profiles created while
 * the portal was disabled can gain accounts later without being recreated, so
 * their ids, booking assignments and history survive.
 *
 * The account is created with NO usable password. The response returns a
 * one-time activation path exactly once - only its hash is stored - and the
 * operator passes it to the technician out of band. This application has no mail
 * delivery and no password-reset flow, so inventing an emailed invitation (or an
 * administrator-chosen password) would be a weaker substitute; the limitation is
 * documented in SECURITY.md.
 *
 * Provisioning is itself a management mutation, so it is refused while
 * technician management is switched off. It does not require the portal to be on:
 * an account that exists while the portal is off simply cannot be used yet.
 */
export const POST = apiHandler(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const guard = await adminWriteGuard(request);
    if (!guard.ok) return guard.response;

    await assertTechnicianAdminManagementEnabled();

    const id = await readIdParam(context.params);
    const body = await parseJson(request, adminTechnicianAccountSchema);

    const result = await provisionTechnicianAccount(
      id,
      { email: body.email, phone: body.phone },
      asAdminActor(guard.user),
    );

    return jsonOk(result, { status: 201 });
  },
);
