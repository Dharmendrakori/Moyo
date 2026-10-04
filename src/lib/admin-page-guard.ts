import 'server-only';
import { redirect, notFound } from 'next/navigation';
import { getCurrentUser, type SessionUser } from './auth';
import { safeRedirectPath } from './redirect';
import { ROLE_LABEL } from './domain';

/**
 * ADMIN PAGE AUTHORIZATION
 *
 * The server-side check every admin page runs in its OWN body, in addition to
 * the guard in `app/admin/layout.tsx`.
 *
 * WHY BOTH:
 * - The layout is defence in depth. It stops an unauthorized visitor before any
 *   page content is produced.
 * - This function makes each page independently safe. If a page were ever moved
 *   out from under the admin layout, or the layout were refactored, the screen
 *   would still refuse an unauthorized visitor.
 *
 * Why it is `notFound()` rather than a 403 for non-admins: an admin page should
 * not advertise its existence to someone who may not use it. The layout already
 * renders an explicit, role-aware access-denied screen for an authenticated
 * non-admin, which is reached first in normal navigation; this is the fallback
 * for a direct, deeper request.
 *
 * No page under `/admin` treats a hidden navigation link, a disabled button or
 * a client-side role check as authorization. Only this function and the
 * `/api/admin/**` guards are.
 */
export async function requireAdminPage(fallback = '/admin'): Promise<SessionUser> {
  const user = await getCurrentUser();

  // No session: send to sign in. `safeRedirectPath` keeps the `next` value
  // same-origin, so this can never become an open redirect.
  if (!user) redirect(`/login?next=${encodeURIComponent(safeRedirectPath(fallback, fallback))}`);

  // Authenticated but not an administrator: refuse, and do not reveal the page.
  if (user.role !== 'ADMIN') notFound();

  return user;
}

/** Human label for a role, for page copy. */
export function roleLabel(role: string): string {
  return ROLE_LABEL[role as keyof typeof ROLE_LABEL] ?? role;
}
