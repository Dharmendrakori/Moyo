import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { AdminShell } from '@/components/admin/Chrome';
import { initials } from '@/lib/format';

/**
 * ADMIN LAYOUT
 *
 * A completely separate surface from the customer application: its own chrome,
 * navigation and visual language.
 *
 * AUTHORIZATION: `requireAdmin` throws for a missing or non-admin session and we
 * redirect to /login. This is defence in depth - every admin page and every
 * admin API route re-checks the role independently, so hiding a sidebar link is
 * never what protects a screen.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin().catch(() => null);
  if (!user) redirect('/login?next=/admin');

  return (
    <AdminShell nav={ADMIN_NAV} userName={user.name} userInitials={initials(user.name)}>
      {children}
    </AdminShell>
  );
}