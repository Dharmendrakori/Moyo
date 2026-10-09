/// <reference types="vitest/globals" />

/**
 * CUSTOMER SHELL NAVIGATION TESTS
 *
 * The Account entry of the shared customer shell must resolve per session:
 *
 *  - Signed-in users of EVERY role (CUSTOMER, PROVIDER, TECHNICIAN, ADMIN)
 *    are sent to their personal `/account` page from both the desktop header
 *    avatar and the mobile bottom bar. No role is ever bounced to `/admin`.
 *  - Anonymous visitors get `/login?next=%2Faccount` from the bottom bar's
 *    Account item, so the requested page survives the login hop; the desktop
 *    header offers a plain `Sign in` link at `/login`.
 *
 * The REAL `CustomerHeader` / `BottomNav` server components are executed; only
 * their data sources are mocked (`getCurrentUser`, Prisma) and `next/link` is
 * stubbed. The resulting element tree is walked directly rather than rendered
 * to HTML: these components are hook-free, so the tree IS the render contract,
 * and this keeps React's dual module resolution (inlined `react` in the Vitest
 * node environment, external `react-dom`) out of a routing test. Every `Link`
 * in the shell passes a plain-string `href`, so collecting string `href` props
 * yields exactly the navigation destinations a browser would receive.
 *
 * The `(customer)` route-group layout mounts this shell once, which is what
 * carries the Account entry on `/`, `/categories`, `/bookings` and
 * `/services/*`; the wiring tests below pin that.
 */

vi.mock('next/link', () => ({
  // Never invoked: the tree walk reads href props without rendering elements.
  default: function LinkStub(): null {
    return null;
  },
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: { provider: { findFirst: async () => null } } }));

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BottomNav, CustomerHeader } from '../src/components/customer/Shell';
import { getCurrentUser, type SessionUser } from '../src/lib/auth';
import { ROLES, type Role } from '../src/lib/domain';

type ShellElement = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

type NavLink = { href: string; text: string; ariaLabel: string | null };

function isElement(node: unknown): node is ShellElement {
  return (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    'props' in node &&
    typeof (node as ShellElement).props === 'object'
  );
}

function walk(node: unknown, visit: (node: ShellElement) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isElement(node)) return;
  visit(node);
  walk(node.props.children, visit);
}

/** All visible text inside an element subtree. */
function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isElement(node)) return textOf(node.props.children);
  return '';
}

/** Every anchor in document order, with its destination and label. */
function linksIn(tree: unknown): NavLink[] {
  const links: NavLink[] = [];
  walk(tree, (el) => {
    const href = el.props.href;
    if (typeof href !== 'string') return;
    const ariaLabel = el.props['aria-label'];
    links.push({
      href,
      text: textOf(el.props.children).trim(),
      ariaLabel: typeof ariaLabel === 'string' ? ariaLabel : null,
    });
  });
  return links;
}


function sessionUser(role: Role): SessionUser {
  return {
    id: `user-${role.toLowerCase().padEnd(24, '0')}`,
    name: 'Test User',
    email: 'test@example.com',
    phone: '9876543210',
    role,
    isActive: true,
    providerId: null,
    technicianId: null,
  };
}

async function headerLinks(user: SessionUser | null): Promise<NavLink[]> {
  vi.mocked(getCurrentUser).mockResolvedValue(user);
  return linksIn(await CustomerHeader());
}

async function bottomNavLinks(user: SessionUser | null): Promise<NavLink[]> {
  vi.mocked(getCurrentUser).mockResolvedValue(user);
  return linksIn(await BottomNav());
}

/** The four fixed bottom-bar destinations before the Account item. */
const FIXED_BOTTOM_HREFS = ['/', '/categories', '/book', '/bookings'];

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(getCurrentUser).mockResolvedValue(null);
});

describe('customer shell Account navigation', () => {
  it('sends every signed-in role to /account from the header avatar', async () => {
    for (const role of ROLES) {
      const links = await headerLinks(sessionUser(role));
      expect(links.map((l) => l.href), role).toEqual([
        '/',
        '/categories',
        '/book',
        '/bookings',
        '/account',
      ]);
      const account = links.at(-1);
      expect(account?.ariaLabel, role).toBe('Your account');
      expect(account?.text, role).toContain('Test User');
    }
  });

  it('resolves the bottom-bar Account item to /account for every signed-in role', async () => {
    for (const role of ROLES) {
      const links = await bottomNavLinks(sessionUser(role));
      expect(links.map((l) => l.href), role).toEqual([...FIXED_BOTTOM_HREFS, '/account']);
      expect(links.at(-1)?.text, role).toBe('Account');
    }
  });

  it('keeps /account as a safe next for anonymous visitors in the bottom bar', async () => {
    const links = await bottomNavLinks(null);
    expect(links.map((l) => l.href)).toEqual([
      ...FIXED_BOTTOM_HREFS,
      '/login?next=%2Faccount',
    ]);
    expect(links.at(-1)?.text).toBe('Account');
  });

  it('offers anonymous visitors a Sign in link at /login with no Account avatar', async () => {
    const links = await headerLinks(null);
    expect(links.map((l) => l.href)).toEqual([...FIXED_BOTTOM_HREFS, '/login']);
    expect(links.at(-1)?.text).toBe('Sign in');
    expect(links.some((l) => l.href === '/account')).toBe(false);
  });

  it('never renders an /admin destination from the shell, for any role or anonymous', async () => {
    for (const user of [...ROLES.map(sessionUser), null]) {
      const links = [...(await headerLinks(user)), ...(await bottomNavLinks(user))];
      const isAdminHref = links.some(
        (l) => l.href === '/admin' || l.href.startsWith('/admin/'),
      );
      expect(isAdminHref, user?.role ?? 'anonymous').toBe(false);
    }
  });
});

describe('shared shell wiring for the (customer) route group', () => {
  const groupDir = path.join(process.cwd(), 'src', 'app', '(customer)');

  it('mounts CustomerHeader and BottomNav in the layout every customer route inherits', () => {
    const layout = readFileSync(path.join(groupDir, 'layout.tsx'), 'utf8');
    expect(layout).toContain('<CustomerHeader />');
    expect(layout).toContain('<BottomNav />');
  });

  it('keeps the homepage and the linked routes inside the (customer) group', () => {
    const routes = [
      'page.tsx', // homepage /
      'categories/page.tsx',
      'services/[slug]/page.tsx',
      'bookings/page.tsx',
      'account/page.tsx',
    ];
    for (const route of routes) {
      expect(existsSync(path.join(groupDir, route)), route).toBe(true);
    }
    // A root-level homepage would render outside the shared shell (no Account nav).
    expect(existsSync(path.join(process.cwd(), 'src', 'app', 'page.tsx'))).toBe(false);
  });
});
