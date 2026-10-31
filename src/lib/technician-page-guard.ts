import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from './auth';
import { getTechnicianFeatures } from './technician-features';
import { resolveTechnicianProfile, type TechnicianSession } from './technician-access';

/**
 * GUARD FOR THE PORTAL PAGES
 *
 * The same four gates as `requireTechnicianApi`, expressed for a server component:
 *
 *   1. the portal feature is enabled;
 *   2. a live session exists (a signed-out visitor is sent to the portal login);
 *   3. the role is exactly TECHNICIAN;
 *   4. the linked profile exists and is active.
 *
 * A disabled portal 404s rather than redirecting: a page that does not exist must
 * not advertise itself, and there is nowhere useful to send a visitor whose role
 * may not use the surface. Every page in the portal group calls this in its own
 * body as well as in the layout, so moving a page out of the group cannot silently
 * drop the check.
 *
 * Kept separate from `technician-access.ts` so that module (and its tests) never
 * pulls the Next router into scope.
 */
export async function requireTechnicianPage(): Promise<TechnicianSession> {
  const features = await getTechnicianFeatures();
  if (!features.portalEnabled) notFound();

  const user = await getCurrentUser();
  if (!user) redirect('/technician/login');
  if (user.role !== 'TECHNICIAN' || !user.technicianId) notFound();

  const technician = await resolveTechnicianProfile(user.technicianId);
  if (!technician) notFound();

  return { user, technician };
}
