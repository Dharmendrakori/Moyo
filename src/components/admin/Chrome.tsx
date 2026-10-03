'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LogoutButton } from '@/components/admin/LogoutButton';
import type { AdminNavGroup } from '@/lib/admin-nav';

/**
 * ADMIN CHROME
 *
 * Sidebar + topbar + breadcrumb. Client-side only because active-link
 * highlighting needs `usePathname`; everything it renders is static navigation
 * metadata with no sensitive values.
 *
 * The sidebar is a fixed column on desktop and an off-canvas drawer on mobile.
 */
export function AdminShell({
  nav,
  userName,
  userInitials,
  children,
}: {
  nav: AdminNavGroup[];
  userName: string;
  userInitials: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const activeItem = findActive(nav, pathname);

  return (
    <div className="min-h-screen bg-ink-50">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      {/* ---------- Desktop sidebar ---------- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-ink-800 bg-ink-900 lg:flex">
        <div className="flex h-16 shrink-0 items-center gap-2 border-b border-ink-800 px-5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
            <Icon name="bolt" size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-tight text-white">MOYO</p>
            <p className="text-[10px] font-medium uppercase tracking-wider text-ink-400">
              Admin console
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Admin navigation">
          <NavList nav={nav} pathname={pathname} />
        </nav>

        <div className="shrink-0 border-t border-ink-800 p-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-ink-400 transition hover:bg-ink-800 hover:text-white"
          >
            <Icon name="external" size={14} />
            View customer site
          </Link>
        </div>
      </aside>

      {/* ---------- Mobile drawer ---------- */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-ink-900/60"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside
            className="absolute inset-y-0 left-0 flex w-72 animate-slide-up flex-col border-r border-ink-800 bg-ink-900"
            role="dialog"
            aria-modal="true"
            aria-label="Admin navigation"
          >
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-ink-800 px-5">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
                  <Icon name="bolt" size={18} />
                </span>
                <p className="text-sm font-bold text-white">MOYO Admin</p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-800 hover:text-white"
                aria-label="Close navigation"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <nav
              className="flex-1 overflow-y-auto px-3 py-4"
              aria-label="Admin navigation"
              onClick={() => setDrawerOpen(false)}
            >
              <NavList nav={nav} pathname={pathname} />
            </nav>
          </aside>
        </div>
      )}

      <Topbar
        title={activeItem?.label ?? 'Dashboard'}
        onOpenNav={() => setDrawerOpen(true)}
        userName={userName}
        userInitials={userInitials}
      />

      <main id="admin-main" className="px-4 pb-12 pt-4 sm:px-6 lg:ml-64 lg:p-8">
        <nav aria-label="Breadcrumb" className="mb-4">
          <ol className="flex items-center gap-1.5 text-xs text-ink-500">
            <li>
              <Link href="/admin" className="transition hover:text-brand-600">
                Admin
              </Link>
            </li>
            {activeItem && activeItem.href !== '/admin' && (
              <>
                <li aria-hidden className="text-ink-300">
                  /
                </li>
                <li className="font-medium text-ink-700" aria-current="page">
                  {activeItem.label}
                </li>
              </>
            )}
          </ol>
        </nav>
        {children}
      </main>
    </div>
  );
}

/** Renders the grouped navigation list. Shared by desktop and mobile. */
function NavList({ nav, pathname }: { nav: AdminNavGroup[]; pathname: string }) {
  return (
    <>
      {nav.map((group) => (
        <div key={group.heading} className="mb-5">
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            {group.heading}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(item.href, item.exact, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      active
                        ? 'bg-brand-600 text-white'
                        : 'text-ink-300 hover:bg-ink-800 hover:text-white'
                    }`}
                  >
                    <Icon name={item.icon} size={16} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

function Topbar({
  title,
  onOpenNav,
  userName,
  userInitials,
}: {
  title: string;
  onOpenNav: () => void;
  userName: string;
  userInitials: string;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-200 bg-white px-4 sm:px-6 lg:ml-64 lg:px-8">
      <button
        type="button"
        onClick={onOpenNav}
        className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 lg:hidden"
        aria-label="Open navigation"
      >
        <Icon name="menu" size={20} />
      </button>

      <h2 className="text-base font-semibold text-ink-900">{title}</h2>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-xs font-semibold text-ink-800">{userName}</p>
          <p className="text-[10px] uppercase tracking-wider text-ink-400">Administrator</p>
        </div>
        <span className="grid h-9 w-9 place-items-center rounded-full bg-ink-900 text-xs font-bold text-white">
          {userInitials}
        </span>
        <LogoutButton />
      </div>
    </header>
  );
}

function isActive(href: string, exact: boolean | undefined, pathname: string): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** Longest-prefix match wins so /admin/bookings beats /admin. */
function findActive(nav: AdminNavGroup[], pathname: string) {
  const all = nav.flatMap((g) => g.items);
  return (
    all
      .filter((i) => isActive(i.href, i.exact, pathname))
      .sort((a, b) => b.href.length - a.href.length)[0] ?? null
  );
}