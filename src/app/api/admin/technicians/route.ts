import { adminReadGuard, adminWriteGuard, asAdminActor } from '@/lib/admin-api';
import { apiHandler, jsonOk, parseJson } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { adminTechnicianCreateSchema } from '@/lib/validation';
import {
  assertTechnicianAdminManagementEnabled,
  getTechnicianFeatures,
} from '@/lib/technician-features';
import { createTechnicianProfile } from '@/lib/technicians';

/**
 * GET /api/admin/technicians
 *
 * The DISPATCH roster: real technician records, so an operator can assign one to
 * a booking. Kept deliberately unfiltered and unpaged because this endpoint backs
 * the assignment dialog, which needs the whole roster; the console's own table
 * reads through `listTechnicians()` server-side instead (search, filters, paging).
 *
 * READ-ONLY ON PURPOSE: this endpoint stays available even when technician
 * MANAGEMENT is switched off, because dispatch must keep working. Only the write
 * endpoints below consult that flag.
 *
 * No technician names, phones, ratings or availability are invented - every
 * value comes from a Technician row, and `isActive` / `isAvailable` are what the
 * server re-validates at assignment time.
 */
export const GET = apiHandler(async (request: Request) => {
  const guard = await adminReadGuard(request);
  if (!guard.ok) return guard.response;

  const technicians = await prisma.technician.findMany({
    orderBy: { displayName: 'asc' },
    select: {
      id: true,
      displayName: true,
      headline: true,
      phone: true,
      skills: true,
      serviceAreas: true,
      isActive: true,
      isAvailable: true,
      createdAt: true,
      provider: { select: { id: true, displayName: true } },
    },
  });

  return jsonOk({ technicians });
});

/**
 * POST /api/admin/technicians
 *
 * Creates a roster profile. When the technician PORTAL feature is enabled, the
 * same transaction also provisions a linked TECHNICIAN login with an unusable
 * password and a single-use activation token, and the response carries the
 * activation path exactly once (see src/lib/technicians.ts).
 *
 * GUARD ORDER is the standard one: same-origin -> ADMIN -> CSRF -> rate limit,
 * then the feature switch, then a strict body. Nothing privileged (`role`,
 * `userId`, `providerId`, `passwordHash`) is accepted from the client.
 */
export const POST = apiHandler(async (request: Request) => {
  const guard = await adminWriteGuard(request);
  if (!guard.ok) return guard.response;

  await assertTechnicianAdminManagementEnabled();

  const body = await parseJson(request, adminTechnicianCreateSchema);
  const features = await getTechnicianFeatures();

  const { technician, activationPath } = await createTechnicianProfile(
    {
      displayName: body.displayName,
      headline: body.headline,
      skills: body.skills,
      serviceAreas: body.serviceAreas,
      phone: body.phone,
      isActive: body.isActive,
      isAvailable: body.isAvailable,
      accountEmail: body.accountEmail,
      accountPhone: body.accountPhone,
    },
    asAdminActor(guard.user),
    features.portalEnabled,
  );

  return jsonOk({ technician, activationPath }, { status: 201 });
});
