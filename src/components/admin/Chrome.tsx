'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
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
 * Layout is structural: at `lg`+ a flex row holds the sidebar as the
 * FIRST column and a right-hand column containing the header plus main
 * content. Below `lg` the sidebar column hides and the header carries a
 * mobile-only opener for the overlay drawer. The sidebar therefore occupies
 * its own width and can never overlay the dashboard, and it OWNS the desktop
 * toggle — the three-lines collapse button lives in the sidebar's brand row,
 * not in the header. The only overlay is the mobile drawer (below `lg`).
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
  // Desktop collapse and the mobile drawer are SEPARATE states:
  // `sidebarCollapsed` switches the desktop (lg+) sidebar between the full
  // w-64 column and the w-20 icon rail; `drawerOpen` only controls the
  // below-lg overlay drawer. One never drives the other. The desktop toggle
  // lives in the sidebar's brand row and directly flips the single
  // `sidebarCollapsed` boolean; the header holds only a `lg:hidden` mobile
  // drawer opener (a separate control for the separate `drawerOpen` state).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const activeItem = findActive(nav, pathname);
  const roleLabel = ROLE_LABEL[userRole as keyof typeof ROLE_LABEL] ?? userRole;

  // Desktop collapse is a persistent layout state (no Escape handling); the
  // drawer below is a modal overlay closed by its button, backdrop, or Escape.
  const toggleDesktopSidebar = () => setSidebarCollapsed((collapsed) => !collapsed);

  // Escape closes the mobile drawer. Desktop collapse needs no such handling.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <div className="flex flex-1 items-stretch">
        {/*
          Sidebar: a structural LEFT column at lg+, never an overlay.
          Expanded = w-64 with icon + labels; collapsed = w-20 icon rail.
          The width transition animates the column so <main> grows/shrinks
          naturally — no margins, no absolute positioning, no lg:ml-64.
          Hidden below lg: mobile/tablet use the overlay drawer instead, so no
          full-width navy bar ever appears above the page header.
        */}
        <aside
          id="admin-sidebar"
          aria-label="Admin navigation"
          className={`hidden shrink-0 flex-col overflow-hidden border-r border-ink-800 bg-ink-900 transition-[width] duration-200 motion-reduce:transition-none lg:sticky lg:top-0 lg:flex lg:h-screen ${
            sidebarCollapsed ? 'lg:w-20' : 'lg:w-64'
          }`}
        >
          <div
            className={`flex h-16 shrink-0 items-center gap-2.5 border-b border-white/10 ${
              sidebarCollapsed ? 'lg:justify-center lg:gap-1 lg:px-1' : 'px-4'
            }`}
          >
            {/* Brand mark. The wordmark hides in the collapsed rail; the mark stays. */}
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-white ring-1 ring-inset ring-white/15">
              <Icon name="bolt" size={18} />
            </span>
            <div className={`min-w-0 flex-1 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
              <p className="truncate text-sm font-bold leading-tight tracking-tight text-white">
                Seric Tech
              </p>
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                Operations console
              </p>
            </div>
            {/*
              Desktop collapse toggle: switches the lg+ sidebar between the
              full w-64 column and the w-20 icon rail. The sidebar itself is
              lg-only (`hidden ... lg:flex`), so this button never renders as
              a stray top bar below lg — small screens use the header's
              mobile-only drawer opener instead.
            */}
            <button
              type="button"
              data-testid="admin-sidebar-toggle"
              onClick={toggleDesktopSidebar}
              aria-controls="admin-sidebar"
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? 'Expand admin sidebar' : 'Collapse admin sidebar'}
              title={sidebarCollapsed ? 'Expand admin sidebar' : 'Collapse admin sidebar'}
              className={`shrink-0 rounded-lg p-1.5 text-ink-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400 ${
                sidebarCollapsed ? 'lg:hidden' : ''
              }`}
            >
              <Icon name="menu" size={18} />
            </button>
          </div>

          <nav
            className={`hidden flex-1 overflow-y-auto overflow-x-hidden py-4 lg:block ${
              sidebarCollapsed ? 'px-2' : 'px-3'
            }`}
            aria-label="Admin navigation"
          >
            <NavList nav={nav} pathname={pathname} collapsed={sidebarCollapsed} />
          </nav>

          <div
            className={`hidden shrink-0 space-y-1 border-t border-white/10 lg:block ${
              sidebarCollapsed ? 'p-2' : 'p-3'
            }`}
          >
            <Link
              href="/"
              title={sidebarCollapsed ? 'View customer site' : undefined}
              aria-label={sidebarCollapsed ? 'View customer site' : undefined}
              className={`flex items-center gap-2.5 rounded-lg py-2 text-xs font-medium text-ink-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400 ${
                sidebarCollapsed ? 'justify-center px-0' : 'px-3'
              }`}
            >
              <Icon name="external" size={14} className="shrink-0" />
              <span className={sidebarCollapsed ? 'hidden' : ''}>View customer site</span>
            </Link>
            <p
              className={`px-3 pb-1 pt-2 text-[10px] leading-relaxed text-ink-500 ${
                sidebarCollapsed ? 'hidden' : ''
              }`}
            >
              Sign-in session checked on every request.
            </p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/*
            The header sits INSIDE the right-hand column, beside the sidebar.
            It carries the breadcrumb, page title, administrator identity and
            logout plus one mobile-only opener for the below-lg drawer — the
            desktop collapse toggle lives in the sidebar's brand row, so the
            header never duplicates it.
          */}
          <Topbar
            title={activeItem?.label ?? 'Dashboard'}
            isAdminHome={!activeItem || activeItem.href === '/admin'}
            userName={userName}
            userInitials={userInitials}
            roleLabel={roleLabel}
            onOpenDrawer={() => setDrawerOpen(true)}
          />
          <main id="admin-main" className="min-w-0 flex-1 px-4 pb-14 pt-6 sm:px-6 lg:px-8 lg:pt-8">
            {children}
          </main>
        </div>
      </div>

      {/* ---------- Mobile drawer (overlay only, z-index legitimate here) ---------- */}
      {drawerOpen && (
        <div id="admin-mobile-drawer" className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-ink-900/60 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside
            className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] animate-slide-up flex-col border-r border-ink-800 bg-ink-900"
            role="dialog"
            aria-modal="true"
            aria-label="Admin navigation"
          >
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-white ring-1 ring-inset ring-white/15">
                  <Icon name="bolt" size={18} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold leading-tight text-white">Seric Tech</p>
                  <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                    Operations console
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-2 text-ink-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400"
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
              <Link
                href="/"
                className="mt-2 flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-ink-400 transition hover:bg-white/10 hover:text-white"
              >
                <Icon name="external" size={14} />
                View customer site
              </Link>
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
      {nav.map((group, index) => (
        <div
          key={group.heading}
          className={`${index > 0 ? 'mt-5' : ''} ${index > 0 && !collapsed ? 'border-t border-white/10 pt-4' : ''}`}
        >
          {/*
            Group separation: a subtle hairline with matching padding above —
            but never above the first group, and not in the collapsed icon rail
            where the section headings that give the separators meaning are
            hidden.
          */}
          <p
            className={`px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500 ${
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
                      className={`flex cursor-not-allowed items-center gap-2.5 rounded-lg py-2 text-[13px] font-medium text-ink-500 ${
                        collapsed ? 'justify-center px-0' : 'px-3'
                      }`}
                    >
                      <Icon name={item.icon} size={16} className="shrink-0 text-ink-600" />
                      <span className={`flex-1 truncate ${collapsed ? 'hidden' : ''}`}>
                        {item.label}
                      </span>
                      <span
                        className={`rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ink-500 ${
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
                    className={`relative flex items-center gap-2.5 rounded-lg py-2 text-[13px] font-medium transition ${
                      collapsed ? 'justify-center px-0' : 'px-3'
                    } ${
                      active
                        ? 'bg-white/10 text-white shadow-xs'
                        : 'text-ink-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {/* Active marker: a second, non-colour cue beside the tint. */}
                    {active && (
                      <span
                        aria-hidden
                        className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand-400"
                      />
                    )}
                    <Icon
                      name={item.icon}
                      size={16}
                      className={`shrink-0 ${active ? 'text-brand-300' : 'text-ink-500'}`}
                    />
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
  isAdminHome,
  userName,
  userInitials,
  roleLabel,
  onOpenDrawer,
}: {
  title: string;
  /** On the dashboard there is no parent trail beyond the console root. */
  isAdminHome: boolean;
  /**
   * The header deliberately owns NO desktop navigation button: the desktop
   * collapse toggle lives in the sidebar's brand row (see AdminShell), and
   * the header keeps only its mobile-only drawer opener plus the breadcrumb,
   * page title, administrator identity, avatar and logout — so there is never
   * a desktop duplicate toggle.
   */
  userName: string;
  userInitials: string;
  roleLabel: string;
  onOpenDrawer: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-ink-200 bg-white/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-white/85 sm:px-6 lg:px-8">
      {/*
        Mobile-only drawer opener (`lg:hidden`). The desktop collapse toggle
        is NOT here: it lives in the sidebar's brand row (see AdminShell), so
        desktop never renders two hamburgers.
      */}
      <button
        type="button"
        data-testid="admin-mobile-opener"
        onClick={onOpenDrawer}
        aria-controls="admin-mobile-drawer"
        aria-expanded={false}
        aria-label="Open navigation"
        title="Open navigation"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-600 transition hover:bg-ink-100 hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 lg:hidden"
      >
        <Icon name="menu" size={18} />
      </button>

      <div className="min-w-0">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1.5 text-[11px] leading-none text-ink-400">
            <li>
              <Link href="/admin" className="transition hover:text-brand-600">
                Console
              </Link>
            </li>
            {!isAdminHome && (
              <>
                <li aria-hidden>
                  <Icon name="chevron-right" size={11} className="text-ink-300" />
                </li>
                <li className="truncate font-medium text-ink-600" aria-current="page">
                  {title}
                </li>
              </>
            )}
          </ol>
        </nav>
        <h2 className="mt-1 truncate text-[15px] font-semibold leading-none tracking-tight text-ink-900">
          {title}
        </h2>
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {/* Role is stated as text, from the session the server already verified. */}
        <span className="hidden items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-600 md:inline-flex">
          <Icon name="shield" size={11} />
          {roleLabel}
        </span>
        {/* Authenticated operator identity. Rendered as text, never as an image. */}
        <div className="hidden text-right sm:block">
          <p className="max-w-[12rem] truncate text-xs font-semibold text-ink-800">{userName}</p>
          <p className="text-[10px] uppercase tracking-wider text-ink-400">Signed in</p>
        </div>
        <span
          className="grid h-9 w-9 place-items-center rounded-full bg-ink-900 text-xs font-bold text-white ring-2 ring-white"
          aria-hidden
        >
          {userInitials}
        </span>
        <span className="h-6 w-px bg-ink-200" aria-hidden />
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