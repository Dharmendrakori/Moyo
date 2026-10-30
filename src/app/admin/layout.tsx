import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { ADMIN_NAV, SIDEBAR_COOKIE } from '@/lib/admin-nav';
import { AdminShell } from '@/components/admin/Chrome';
import { initials } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/domain';
import { Icon } from '@/components/ui/Icon';
import { safeRedirectPath } from '@/lib/redirect';

/**
 * ADMIN LAYOUT
 *
 * A completely separate surface from the customer application: its own chrome,
 * navigation and visual language.
 *
 * AUTHORIZATION IS SERVER-SIDE AND HAPPENS BEFORE ANY DATA IS LOADED:
 *
 *   no session at all     -> redirect to /login with a validated relative
 *                            `next` (never an absolute URL, so this cannot
 *                            become an open redirect)
 *   signed in, not ADMIN  -> an explicit access-denied screen that renders NO
 *                            admin navigation and NO database content
 *   signed in, ADMIN      -> the console
 *
 * This layout is the first of three layers. It is not relied on alone: every
 * admin page re-checks the role itself, and every `/api/admin/**` route calls
 * `adminReadGuard` / `adminWriteGuard`. Removing this file would not remove the
 * protection, which is why "hide the nav link" is never treated as a control.
 *
 * Denial is deliberately DISTINGUISHABLE from a missing login. Silently
 * redirecting an authenticated non-admin to /login would loop them forever and
 * hide the reason they were refused.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // Unauthenticated: send them to sign in, preserving where they were going.
  // `safeRedirectPath` is used even though the value is server-constructed, so
  // the redirect contract stays in exactly one place.
  if (!user) redirect(`/login?next=${encodeURIComponent(safeRedirectPath('/admin', '/admin'))}`);

  // Authenticated but not an administrator: refuse, and say why.
  if (user.role !== 'ADMIN') return <AdminAccessDenied role={user.role} />;

  // The operator's desktop sidebar preference, read on the server so the first
  // paint already matches it. Only the exact string 'collapsed' counts, so a
  // tampered or stale cookie can never produce anything but the full sidebar.
  const sidebarCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === 'collapsed';

  return (
    <AdminShell
      nav={ADMIN_NAV}
      userName={user.name}
      userInitials={initials(user.name)}
      userRole={user.role}
      defaultSidebarCollapsed={sidebarCollapsed}
    >
      {children}
    </AdminShell>
  );
}

/**
 * Refusal screen.
 *
 * Renders the visitor's own role so the message is accurate, and deliberately
 * contains no console chrome, no navigation and no queries. It exists to end the
 * attempt clearly, not to route the visitor somewhere else.
 */
function AdminAccessDenied({ role }: { role: string }) {
  const label = ROLE_LABEL[role as keyof typeof ROLE_LABEL] ?? role;

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <main className="w-full max-w-md rounded-card border border-ink-200 bg-white p-8 text-center shadow-card">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-danger-bg text-danger">
          <Icon name="lock" size={24} />
        </span>
        <h1 className="mt-5 text-lg font-bold tracking-tight text-ink-900">Access denied</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          The operations console is restricted to platform administrators. Your account is signed in
          as <span className="font-semibold text-ink-800">{label}</span>, which does not have
          access.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-ink-500">
          This decision was made by the server from your account role. It is not affected by
          anything shown in the browser.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated"
          >
            Back to Seric Tech Solutions
          </Link>
          <Link
            href="/bookings"
            className="rounded-xl px-4 py-2 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
          >
            My bookings
          </Link>
        </div>
      </main>
    </div>
  );
}
