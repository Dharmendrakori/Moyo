import Link from 'next/link';
import type { IconName } from '@/components/ui/Icon';

/**
 * ADMIN INFORMATION ARCHITECTURE
 *
 * Grouped exactly as specified. Defined once as data so the sidebar, the
 * mobile drawer and any command palette stay in sync.
 */

export type AdminNavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** Marks the item in the sidebar as the active page. */
  exact?: boolean;
};

export type AdminNavGroup = {
  heading: string;
  items: AdminNavItem[];
};

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    heading: 'Overview',
    items: [{ href: '/admin', label: 'Dashboard', icon: 'chart', exact: true }],
  },
  {
    heading: 'Operations',
    items: [
      { href: '/admin/bookings', label: 'Bookings', icon: 'clipboard' },
      { href: '/admin/dispatch', label: 'Dispatch', icon: 'truck' },
      { href: '/admin/technicians', label: 'Technicians', icon: 'user' },
      { href: '/admin/providers', label: 'Service providers', icon: 'office' },
    ],
  },
  {
    heading: 'Catalog',
    items: [
      { href: '/admin/categories', label: 'Categories', icon: 'grid' },
      { href: '/admin/subcategories', label: 'Subcategories', icon: 'list' },
      { href: '/admin/services', label: 'Services', icon: 'bolt' },
      { href: '/admin/charging-options', label: 'Charging options', icon: 'receipt' },
      { href: '/admin/materials', label: 'Materials', icon: 'package' },
    ],
  },
  {
    heading: 'Commerce',
    items: [
      { href: '/admin/orders', label: 'Orders', icon: 'truck' },
      { href: '/admin/invoices', label: 'Invoices', icon: 'receipt' },
      { href: '/admin/payments', label: 'Payments', icon: 'wallet' },
    ],
  },
  {
    heading: 'Customers',
    items: [
      { href: '/admin/users', label: 'Users', icon: 'people' },
      { href: '/admin/reviews', label: 'Reviews', icon: 'star' },
      { href: '/admin/referrals', label: 'Referrals', icon: 'sparkle' },
    ],
  },
  {
    heading: 'Communication',
    items: [
      { href: '/admin/notifications', label: 'Notifications', icon: 'bell' },
      { href: '/admin/messages', label: 'Messages', icon: 'message' },
      { href: '/admin/support', label: 'Support', icon: 'shield' },
    ],
  },
  {
    heading: 'Analytics',
    items: [{ href: '/admin/reports', label: 'Reports', icon: 'chart' }],
  },
  {
    heading: 'System',
    items: [
      { href: '/admin/audit-logs', label: 'Audit logs', icon: 'clipboard' },
      { href: '/admin/settings', label: 'Settings', icon: 'settings' },
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
  // Longest match wins so /admin/bookings beats /admin.
  return (
    all
      .filter((i) => (i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`)))
      .sort((a, b) => b.href.length - a.href.length)[0] ?? null
  );
}

/** Convenience export for the "back to site" link. */
export const ADMIN_HOME = '/admin';
export const ADMIN_LOGIN_HINT = Link;