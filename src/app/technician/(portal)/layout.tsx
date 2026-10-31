import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { LogoutButton } from '@/components/admin/LogoutButton';
import { requireTechnicianPage } from '@/lib/technician-page-guard';

export const dynamic = 'force-dynamic';

/**
 * TECHNICIAN PORTAL SHELL
 *
 * Every page in this group runs `requireTechnicianPage()` here AND in its own
 * body, so moving a page out of the group cannot silently drop the check. The
 * guard decides four things from the database: the portal feature is enabled, a
 * session exists, the role is TECHNICIAN, and the linked profile is active.
 *
 * Sign-out returns to the technician sign-in page rather than the customer one.
 */
export default async function TechnicianPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { technician } = await requireTechnicianPage();

  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-4">
            <Link
              href="/technician"
              className="flex items-center gap-2 text-sm font-semibold text-ink-900"
            >
              <Icon name="bolt" size={18} className="text-brand-600" />
              <span className="truncate">Technician</span>
            </Link>
            <nav aria-label="Portal" className="flex items-center gap-3 text-xs font-semibold">
              <Link href="/technician" className="text-ink-600 transition hover:text-brand-700">
                Overview
              </Link>
              <Link href="/technician/jobs" className="text-ink-600 transition hover:text-brand-700">
                My jobs
              </Link>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden text-xs font-medium text-ink-500 sm:inline">
              {technician.displayName}
            </span>
            <LogoutButton redirectTo="/technician/login" />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>

      <footer className="border-t border-ink-200 px-4 py-4 text-center text-xs text-ink-400">
        Seric Tech Solutions · technician portal
      </footer>
    </div>
  );
}
