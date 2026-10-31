import type { IconName } from '@/components/ui/Icon';

/**
 * ADMIN INFORMATION ARCHITECTURE
 *
 * Defined once as data so the sidebar, the mobile drawer and the breadcrumb all
 * stay in sync.
 *
 * `status` is load-bearing. A module is either:
 *
 *   'live'    - a real screen exists, backed by server-side queries
 *   'planned' - not built yet
 *
 * Planned modules are rendered as DISABLED, non-navigable entries with an
 * explicit "Soon" marker. They are deliberately NOT links to pages that do not
 * exist, because a navigation item that leads to a 404 is a broken promise: it
 * advertises a capability the console does not have. No planned module is
 * dressed up with fake functionality, sample rows or placeholder metrics.
 *
 * This is a usability device ONLY. Every 'live' route and every
 * `/api/admin/**` endpoint independently re-checks the session and role on the
 * server, so the disabled state is never what protects a screen.
 */

export type AdminNavStatus = 'live' | 'planned';

export type AdminNavItem = {
  href: string;
  label: string;
  icon: IconName;
  status: AdminNavStatus;
  /** Marks the item in the sidebar as the active page. */
  exact?: boolean;
  /** One line explaining what this module will do. Shown for planned items. */
  hint?: string;
};

export type AdminNavGroup = {
  heading: string;
  items: AdminNavItem[];
};

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    heading: 'Overview',
    items: [{ href: '/admin', label: 'Dashboard', icon: 'chart', status: 'live', exact: true }],
  },
  {
    heading: 'Catalog',
    items: [
      { href: '/admin/categories', label: 'Categories', icon: 'grid', status: 'live' },
      { href: '/admin/services', label: 'Services', icon: 'bolt', status: 'live' },
      { href: '/admin/charging-options', label: 'Charging options', icon: 'receipt', status: 'live' },
      { href: '/admin/pricing', label: 'Pricing', icon: 'wallet', status: 'live' },
    ],
  },
  {
    heading: 'Operations',
    items: [
      {
        href: '/admin/bookings',
        label: 'Bookings',
        icon: 'clipboard',
        status: 'live',
      },
      {
        href: '/admin/technicians',
        label: 'Technicians',
        icon: 'user',
        status: 'live',
      },
      {
        href: '/admin/customers',
        label: 'Customers',
        icon: 'people',
        status: 'planned',
        hint: 'Accounts and booking history',
      },
      {
        href: '/admin/materials',
        label: 'Materials',
        icon: 'package',
        status: 'planned',
        hint: 'Parts catalogue and stock',
      },
    ],
  },
  {
    heading: 'Commerce',
    items: [
      {
        href: '/admin/invoices',
        label: 'Invoices',
        icon: 'receipt',
        status: 'live',
      },
      {
        href: '/admin/payments',
        label: 'Payments',
        icon: 'wallet',
        status: 'live',
      },
    ],
  },
  {
    heading: 'Platform',
    items: [
      {
        href: '/admin/reviews',
        label: 'Reviews',
        icon: 'star',
        status: 'planned',
        hint: 'Moderation of submitted ratings',
      },
      {
        href: '/admin/audit-log',
        label: 'Audit log',
        icon: 'shield',
        status: 'planned',
        hint: 'Operator activity and price history',
      },
      {
        href: '/admin/settings',
        label: 'Settings',
        icon: 'settings',
        status: 'planned',
        hint: 'Platform configuration',
      },
    ],
  },
];

/** Flattens the nav for mobile rendering and breadcrumbs. */
export function flattenAdminNav(): AdminNavItem[] {
  return ADMIN_NAV.flatMap((g) => g.items);
}

/** Finds the nav item matching a pathname, for breadcrumbs and highlighting. */
export function findAdminNavItem(pathname: string): AdminNavItem | null {
  const all = flattenAdminNav();
  // Longest match wins so /admin/services beats /admin.
  return (
    all
      .filter((i) =>
        i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`),
      )
      .sort((a, b) => b.href.length - a.href.length)[0] ?? null
  );
}

/** Whether a nav item should be rendered as the current page. */
export function isNavItemActive(item: AdminNavItem, pathname: string): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The admin root. */
export const ADMIN_HOME = '/admin';

/**
 * Cookie that remembers the desktop sidebar's collapsed state (`collapsed` or
 * `expanded`).
 *
 * It lives in this plain, isomorphic module rather than beside the client
 * component on purpose: a value imported from a `'use client'` module into a
 * server component is a client reference, not the string itself. It is a
 * display preference only - no identity, no authority and no secret - so it is
 * readable by design and excluded from every authorization decision.
 */
export const SIDEBAR_COOKIE = 'moyo_admin_nav';

