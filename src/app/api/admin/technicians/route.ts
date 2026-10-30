import { apiHandler, jsonOk } from '@/lib/api';
import { adminReadGuard } from '@/lib/admin-api';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/admin/technicians
 *
 * Lists actual technician records from the database so an operator can assign
 * one to a booking. No technician names, phones, ratings or availability are
 * invented - every value comes from a Technician row, and `isActive` marks the
 * records eligible for assignment. Assignment re-validates eligibility
 * server-side in the assign endpoint.
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
      isActive: true,
      isAvailable: true,
      totalJobs: true,
      ratingCount: true,
      createdAt: true,
      provider: { select: { id: true, displayName: true } },
    },
  });

  return jsonOk({ technicians });
});