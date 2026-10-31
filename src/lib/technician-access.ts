import 'server-only';
import { AuthError, getCurrentUser, type SessionUser } from './auth';
import { ApiError } from './api';
import { getTechnicianFeatures } from './technician-features';
import { prisma } from './prisma';

/**
 * TECHNICIAN PORTAL AUTHORISATION AND READS
 *
 * ONE place defines what "a technician is signed in" means, so a page and a
 * technician API cannot drift:
 *
 *   1. the portal feature must be ENABLED (read from the database);
 *   2. a live, unrevoked session must exist;
 *   3. the role stored in the database must be exactly TECHNICIAN;
 *   4. a linked Technician profile must exist and be ACTIVE.
 *
 * The role and the technician id come from the session lookup, never from a
 * request parameter. An ADMIN, PROVIDER or CUSTOMER therefore cannot reach
 * technician data by editing a URL or a body: they do not hold a TECHNICIAN role,
 * and the profile lookup is keyed by their own session's technician id, which they
 * do not have.
 *
 * OWNERSHIP: every job read below puts `technicianId` in the `where` clause, so a
 * booking belonging to another technician is never loaded into memory. Filtering
 * after the fetch would be a leak waiting to happen.
 *
 * This module imports NO rendering helpers. The page guard (which needs
 * `redirect`/`notFound` from Next) lives in `technician-page-guard.ts`, so a
 * server module - and a test - can use the API guard and the job reads without
 * pulling the router into scope.
 */

export type TechnicianSession = {
  user: SessionUser;
  technician: { id: string; displayName: string; providerId: string };
};

/** The linked, ACTIVE profile for a session's technician id, or null. */
export async function resolveTechnicianProfile(technicianId: string) {
  return prisma.technician.findFirst({
    where: { id: technicianId, isActive: true },
    select: { id: true, displayName: true, providerId: true },
  });
}

/**
 * Guard for technician API handlers - and the entry point the dispatch-transition
 * milestone reuses for technician-driven status changes, so that work needs no new
 * authorization layer.
 *
 * Errors use the codebase's own types: `AuthError` 401/403 so `apiHandler` maps them
 * to UNAUTHENTICATED/FORBIDDEN, and an explicit `PORTAL_DISABLED` 403 when the
 * feature is off, so the caller is told the truth without learning any data.
 */
export async function requireTechnicianApi(): Promise<TechnicianSession> {
  const features = await getTechnicianFeatures();
  if (!features.portalEnabled) {
    throw new ApiError('PORTAL_DISABLED', 'The technician portal is not available.', 403);
  }

  const user = await getCurrentUser();
  if (!user) throw new AuthError('Authentication required', 401);

  if (user.role !== 'TECHNICIAN' || !user.technicianId) {
    throw new AuthError('You do not have access to this resource', 403);
  }

  const technician = await resolveTechnicianProfile(user.technicianId);
  if (!technician) throw new AuthError('You do not have access to this resource', 403);

  return { user, technician };
}

/** Jobs per page in the portal list. */
export const PORTAL_PAGE_SIZE = 10;

/**
 * The technician's OWN assigned jobs, newest first.
 *
 * Only the fields a dispatch list needs: no customer email, no invoice, no payment,
 * no administrative notes.
 */
export async function listTechnicianJobs(
  technicianId: string,
  options: { status?: string | undefined; page: number },
) {
  const where = { technicianId, ...(options.status ? { status: options.status } : {}) };

  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (options.page - 1) * PORTAL_PAGE_SIZE,
      take: PORTAL_PAGE_SIZE,
      select: {
        id: true,
        reference: true,
        status: true,
        mode: true,
        scheduledFor: true,
        createdAt: true,
        area: true,
        city: true,
        service: { select: { name: true } },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  return { items, total, page: options.page, pageSize: PORTAL_PAGE_SIZE };
}

/**
 * Counts of this technician's open work, for the portal overview.
 *
 * One query over the active statuses; the grouping happens in memory so the portal
 * needs no aggregate endpoint and no second source of truth.
 */
export async function summariseTechnicianJobs(technicianId: string): Promise<{
  assigned: number;
  onTheWay: number;
  inProgress: number;
  upcomingToday: number;
}> {
  const rows = await prisma.booking.findMany({
    where: {
      technicianId,
      status: {
        in: ['TECHNICIAN_ASSIGNED', 'TECHNICIAN_ON_THE_WAY', 'ARRIVED', 'SERVICE_IN_PROGRESS'],
      },
    },
    select: { status: true, scheduledFor: true },
  });

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  return {
    assigned: rows.filter((r) => r.status === 'TECHNICIAN_ASSIGNED').length,
    onTheWay: rows.filter((r) => r.status === 'TECHNICIAN_ON_THE_WAY').length,
    inProgress: rows.filter((r) => r.status === 'ARRIVED' || r.status === 'SERVICE_IN_PROGRESS')
      .length,
    upcomingToday: rows.filter((r) => r.scheduledFor !== null && r.scheduledFor <= endOfToday)
      .length,
  };
}

/**
 * One job, ONLY if it is assigned to this technician.
 *
 * Customer contact is limited to what the visit requires (the dispatch contact and
 * the service address). The account's own email/phone, the invoice and every
 * payment record are deliberately absent from this projection.
 */
export async function getTechnicianJob(technicianId: string, bookingId: string) {
  return prisma.booking.findFirst({
    where: { id: bookingId, technicianId },
    select: {
      id: true,
      reference: true,
      status: true,
      mode: true,
      serviceType: true,
      scheduledFor: true,
      createdAt: true,
      updatedAt: true,
      addressLine1: true,
      addressLine2: true,
      area: true,
      city: true,
      state: true,
      pincode: true,
      landmark: true,
      contactName: true,
      contactPhone: true,
      description: true,
      isEmergency: true,
      service: { select: { name: true } },
      customer: { select: { name: true } },
      technician: { select: { id: true, displayName: true, phone: true } },
      statusEvents: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          from: true,
          to: true,
          actorRole: true,
          note: true,
          createdAt: true,
        },
      },
    },
  });
}
