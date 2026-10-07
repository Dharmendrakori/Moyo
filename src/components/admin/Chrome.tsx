'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LogoutButton } from '@/components/admin/LogoutButton';
import { isNavItemActive, type AdminNavGroup } from '@/lib/admin-nav';
import { ROLE_LABEL } from '@/lib/domain';

/**
 * ADMIN CHROME
 *
 * Sidebar + topbar + breadcrumb. Client-side only because active-link
 * highlighting needs `usePathname`; everything it renders is static navigation
 * metadata with no sensitive values.
 *
 * Layout is structural: the header spans the full width, and below it a flex
 * row holds a sticky desktop sidebar column plus the main content column.
 * The sidebar therefore occupies its own width and can never overlay the
 * dashboard. The only overlay is the mobile drawer (below `lg`).
 *
 * NOTHING HERE IS AN AUTHORIZATION CONTROL. This component renders navigation
 * for whoever the server already proved is an administrator. A non-admin never
 * receives this tree at all, and every admin page and API re-checks the role
 * independently, so hiding or disabling a link changes nothing about access.
 */
export function AdminShell({
  nav,
  userName,
  userInitials,
  userRole,
  children,
}: {
  nav: AdminNavGroup[];
  userName: string;
  userInitials: string;
  userRole: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // Desktop collapse and the mobile drawer are SEPARATE concepts:
  // `sidebarCollapsed` switches the desktop (lg+) sidebar between the full
  // w-64 column and the w-20 icon rail; `drawerOpen` only controls the
  // below-lg overlay drawer. One never drives the other.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const activeItem = findActive(nav, pathname);
  const roleLabel = ROLE_LABEL[userRole as keyof typeof ROLE_LABEL] ?? userRole;

  // ONE header slot, TWO breakpoint-explicit callbacks sharing it:
  // - desktop (lg+) toggles the existing `sidebarCollapsed` rail state;
  // - mobile (below lg) opens the `drawerOpen` overlay.
  // Visibility is decided by Tailwind responsive classes on the buttons
  // themselves (see Topbar), so a desktop click can never open the mobile
  // drawer and vice versa — no runtime breakpoint check to drift.
  const toggleDesktopSidebar = () => setSidebarCollapsed((collapsed) => !collapsed);
  const openMobileDrawer = () => setDrawerOpen(true);

  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <Topbar
        title={activeItem?.label ?? 'Dashboard'}
        onToggleDesktopSidebar={toggleDesktopSidebar}
        onOpenMobileDrawer={openMobileDrawer}
        // Exposed for aria-expanded/aria-controls on the desktop toggle.
        sidebarCollapsed={sidebarCollapsed}
        userName={userName}
        userInitials={userInitials}
        roleLabel={roleLabel}
      />

      <div className="flex flex-1 items-stretch">
        {/*
          Desktop sidebar: a structural column, never an overlay.
          Expanded = w-64 with icon + labels; collapsed = w-20 icon rail.
          The width transition animates the column so <main> grows/shrinks
          naturally — no margins, no absolute positioning, no lg:ml-64.
        */}
        <aside
          id="admin-sidebar"
          aria-label="Admin navigation"
          className={`hidden shrink-0 flex-col overflow-hidden border-r border-ink-800 bg-ink-900 transition-[width] duration-200 lg:sticky lg:top-16 lg:flex lg:h-[calc(100vh-4rem)] ${
            sidebarCollapsed ? 'lg:w-20' : 'lg:w-64'
          }`}
        >
          <div
            className={`flex h-16 shrink-0 items-center border-b border-ink-800 ${
              sidebarCollapsed ? 'justify-center px-2' : 'gap-2 px-5'
            }`}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white">
              <Icon name="bolt" size={18} />
            </span>
            {/* Branding text hides in the collapsed rail; the logo stays. */}
            <div className={`min-w-0 ${sidebarCollapsed ? 'hidden' : ''}`}>
              <p className="whitespace-nowrap text-sm font-bold tracking-tight text-white">MOYO</p>
              <p className="whitespace-nowrap text-[10px] font-medium uppercase tracking-wider text-ink-400">
                Admin console
              </p>
            </div>
          </div>

          <nav
            className={`flex-1 overflow-y-auto py-4 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}
            aria-label="Admin navigation"
          >
            <NavList nav={nav} pathname={pathname} collapsed={sidebarCollapsed} />
          </nav>

          <div className={`shrink-0 border-t border-ink-800 ${sidebarCollapsed ? 'p-2' : 'p-3'}`}>
            <Link
              href="/"
              title={sidebarCollapsed ? 'View customer site' : undefined}
              aria-label={sidebarCollapsed ? 'View customer site' : undefined}
              className={`flex items-center gap-2 rounded-lg py-2 text-xs font-medium text-ink-400 transition hover:bg-ink-800 hover:text-white ${
                sidebarCollapsed ? 'justify-center px-0' : 'px-3'
              }`}
            >
              <Icon name="external" size={14} />
              <span className={sidebarCollapsed ? 'hidden' : ''}>View customer site</span>
            </Link>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <main id="admin-main" className="min-w-0 flex-1 px-4 pb-12 pt-4 sm:px-6 lg:p-8">
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
      </div>

      {/* ---------- Mobile drawer (overlay only, z-index legitimate here) ---------- */}
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
    </div>
  );
}

/** Renders the grouped navigation list. Shared by desktop and mobile. */
function NavList({
  nav,
  pathname,
  collapsed = false,
}: {
  nav: AdminNavGroup[];
  pathname: string;
  /** Collapsed desktop rail: icons only; labels, headings and SOON hidden. */
  collapsed?: boolean;
}) {
  return (
    <>
      {nav.map((group) => (
        <div key={group.heading} className="mb-5">
          <p
            className={`px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500 ${
              collapsed ? 'hidden' : ''
            }`}
            aria-hidden={collapsed || undefined}
          >
            {group.heading}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isNavItemActive(item, pathname);

              /*
               * A planned module is a disabled <span>, not a <Link>. Rendering it
               * as a link to a screen that does not exist would advertise a
               * capability the console does not have.
               */
              if (item.status === 'planned') {
                const soonLabel = `${item.label} - coming soon`;
                return (
                  <li key={item.href}>
                    <span
                      aria-disabled="true"
                      aria-label={collapsed ? soonLabel : undefined}
                      title={item.hint ? `Coming soon - ${item.hint}` : soonLabel}
                      className={`flex cursor-not-allowed items-center gap-2.5 rounded-lg py-2 text-sm font-medium text-ink-600 ${
                        collapsed ? 'justify-center px-0' : 'px-3'
                      }`}
                    >
                      <Icon name={item.icon} size={16} className="shrink-0 text-ink-600" />
                      <span className={`flex-1 truncate ${collapsed ? 'hidden' : ''}`}>
                        {item.label}
                      </span>
                      <span
                        className={`rounded bg-ink-800 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ink-400 ${
                          collapsed ? 'hidden' : ''
                        }`}
                      >
                        Soon
                      </span>
                    </span>
                  </li>
                );
              }

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    title={collapsed ? item.label : undefined}
                    className={`flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium transition ${
                      collapsed ? 'justify-center px-0' : 'px-3'
                    } ${
                      active
                        ? 'bg-brand-600 text-white'
                        : 'text-ink-300 hover:bg-ink-800 hover:text-white'
                    }`}
                  >
                    <Icon name={item.icon} size={16} className="shrink-0" />
                    <span className={`truncate ${collapsed ? 'hidden' : ''}`}>{item.label}</span>
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
  onToggleDesktopSidebar,
  onOpenMobileDrawer,
  sidebarCollapsed,
  userName,
  userInitials,
  roleLabel,
}: {
  title: string;
  /**
   * The desktop (lg+) collapse/expand control for the existing
   * `sidebarCollapsed` state. Always mounted and always wired; visibility is
   * handled by the `hidden lg:block` wrapper so a desktop click can only ever
   * reach this callback — never the mobile drawer.
   */
  onToggleDesktopSidebar: () => void;
  /** Below-lg control that opens the mobile drawer overlay. */
  onOpenMobileDrawer: () => void;
  /** Desktop collapsed state, reflected in aria-expanded. */
  sidebarCollapsed: boolean;
  userName: string;
  userInitials: string;
  roleLabel: string;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-ink-200 bg-white px-4 sm:px-6 lg:px-8">
      {/* Desktop hamburger: visible at lg+, drives the rail state directly. */}
      <span className="hidden lg:block">
        <button
          type="button"
          onClick={onToggleDesktopSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!sidebarCollapsed}
          aria-controls="admin-sidebar"
          className="rounded-lg p-2 text-ink-600 hover:bg-ink-100"
        >
          <Icon name="menu" size={20} />
        </button>
      </span>
      {/* Mobile hamburger: visible below lg, opens the drawer overlay. */}
      <span className="lg:hidden">
        <button
          type="button"
          onClick={onOpenMobileDrawer}
          aria-label="Open navigation"
          aria-controls="admin-sidebar"
          className="rounded-lg p-2 text-ink-600 hover:bg-ink-100"
        >
          <Icon name="menu" size={20} />
        </button>
      </span>

      <h2 className="text-base font-semibold text-ink-900">{title}</h2>

      <div className="ml-auto flex items-center gap-3">
        {/*
          Authenticated operator identity and role. Rendered as text, never as
          an image, and derived from the session the server already verified.
        */}
        <div className="hidden text-right sm:block">
          <p className="max-w-[12rem] truncate text-xs font-semibold text-ink-800">{userName}</p>
          <p className="text-[10px] uppercase tracking-wider text-ink-400">{roleLabel}</p>
        </div>
        <span
          className="grid h-9 w-9 place-items-center rounded-full bg-ink-900 text-xs font-bold text-white"
          aria-hidden
        >
          {userInitials}
        </span>
        <LogoutButton />
      </div>
    </header>
  );
}

/** Longest-prefix match wins so /admin/services beats /admin. */
function findActive(nav: AdminNavGroup[], pathname: string) {
  const all = nav.flatMap((g) => g.items);
  return (
    all
      .filter((i) => isNavItemActive(i, pathname))
      .sort((a, b) => b.href.length - a.href.length)[0] ?? null
  );
}