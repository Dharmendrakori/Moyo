/// <reference types="vitest/globals" />

/**
 * LOGIN: SIGN-IN-REQUIRED MESSAGING + ACTIONS
 *
 * When an anonymous visitor is sent to `/login?next=%2Fbookings` (the edge
 * proxy redirects them there from `/bookings`), the login page must:
 *   - show the friendly "Please sign in to view, track, and manage your
 *     bookings." message, so the reason for the sign-in wall is obvious;
 *   - offer working Sign in and Create an account actions, with the requested
 *     page preserved through the Create an account hop;
 *   - NOT show that message on a plain `/login` visit (no protected `next`).
 *
 * When a user is already signed in, the page redirects to the validated `next`
 * destination rather than showing the form.
 *
 * The REAL `LoginPage` server component is executed; only its data sources
 * (`getCurrentUser`) and `redirect` are mocked, and the element tree is walked
 * directly (the page is hook-free, so the tree IS the render contract).
 */

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));

import { redirect } from 'next/navigation';
import { getCurrentUser, type SessionUser } from '@/lib/auth';
import LoginPage from '../src/app/(customer)/login/page';

type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

function isElement(node: unknown): node is El {
  return (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    'props' in node &&
    typeof (node as El).props === 'object'
  );
}

function walk(node: unknown, visit: (el: El) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isElement(node)) return;
  visit(node);
  walk(node.props.children, visit);
}

function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isElement(node)) return textOf(node.props.children);
  return '';
}

function anchorsIn(tree: unknown): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = [];
  walk(tree, (el) => {
    if (el.type === 'a' && typeof el.props.href === 'string') {
      out.push({ href: el.props.href, text: textOf(el.props.children).trim() });
    }
  });
  return out;
}

async function render(searchParams: Record<string, string>): Promise<unknown> {
  return LoginPage({ searchParams: Promise.resolve(searchParams) });
}

const MESSAGE = 'Please sign in to view, track, and manage your bookings.';

const customer: SessionUser = {
  id: 'ccustomer00000000000000001',
  name: 'Test User',
  email: 'customer@example.com',
  phone: '9800000000',
  role: 'CUSTOMER',
  isActive: true,
  providerId: null,
  technicianId: null,
};

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(redirect).mockClear();
});

describe('LoginPage: anonymous visitor sent from a protected page', () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
  });

  it('shows the friendly sign-in-required message when a protected next is present', async () => {
    const tree = await render({ next: '/bookings' });
    expect(textOf(tree)).toContain(MESSAGE);
  });

  it('does NOT show that message on a plain /login visit (no next)', async () => {
    const tree = await render({});
    expect(textOf(tree)).not.toContain(MESSAGE);
  });

  it('preserves the requested page on the Create an account action', async () => {
    const tree = await render({ next: '/bookings' });
    const create = anchorsIn(tree).find((a) => a.text === 'Create an account');
    expect(create?.href).toBe('/register?next=%2Fbookings');
  });

  it('uses a plain /register link when there is no requested page', async () => {
    const tree = await render({});
    const create = anchorsIn(tree).find((a) => a.text === 'Create an account');
    expect(create?.href).toBe('/register');
  });

  it('does not redirect an anonymous visitor', async () => {
    await render({ next: '/bookings' });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('LoginPage: already-signed-in visitor', () => {
  it('redirects to the validated next destination instead of showing the form', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(customer);
    await expect(render({ next: '/bookings' })).rejects.toThrow('REDIRECT:/bookings');
    expect(redirect).toHaveBeenCalledWith('/bookings');
  });

  it('falls back to the homepage when no next is supplied', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(customer);
    await expect(render({})).rejects.toThrow('REDIRECT:/');
  });
});
