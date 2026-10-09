import Link from 'next/link';
import { cn, initials, telLink, whatsappLink } from '@/lib/format';
import { Icon, type IconName } from '@/components/ui/Icon';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * CUSTOMER SHELL
 *
 * Desktop: a conventional sticky header with primary navigation.
 * Mobile: a condensed header plus a fixed bottom navigation bar for thumb reach.
 *
 * All data here comes from the real session and provider records. No fabricated
 * technician availability, ETAs or ratings appear anywhere.
 */

export type NavItem = { href: string; label: string; icon: IconName };

/**
 * Primary navigation.
 *
 * Only routes that actually exist are linked. `/orders` and `/support` are not
 * implemented yet, so they are omitted rather than rendered as dead links.
 */
const PRIMARY_NAV: NavItem[] = [
  { href: '/categories', label: 'Categories', icon: 'grid' },
  { href: '/book', label: 'Book a service', icon: 'bolt' },
  { href: '/bookings', label: 'My bookings', icon: 'clipboard' },
];

/**
 * Mobile bottom navigation, per the specification.
 *
 * "Booking" points at the wizard (`/book`), which is the central customer
 * action. The Account item resolves per session: signed-in users go to their
 * personal `/account` page (every role, including ADMIN), anonymous visitors
 * go to `/login`. BottomNav is a server component so it can read the session.
 */
const BOTTOM_NAV: NavItem[] = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/categories', label: 'Menu', icon: 'grid' },
  { href: '/book', label: 'Booking', icon: 'bolt' },
  { href: '/bookings', label: 'Bookings', icon: 'clipboard' },
];

/** Account destination: personal page when signed in, login otherwise. */
const ACCOUNT_NAV_SIGNED_IN: NavItem = { href: '/account', label: 'Account', icon: 'user' };
const ACCOUNT_NAV_SIGNED_OUT: NavItem = { href: '/login', label: 'Account', icon: 'user' };

/**
 * Primary provider's published contact details.
 * Returns null fields rather than inventing anything.
 */
export async function getPrimaryProvider() {
  return prisma.provider.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: {
      displayName: true,
      contactPhone: true,
      whatsappNumber: true,
      contactEmail: true,
      description: true,
      registeredAddress: true,
      serviceAreaCities: true,
      isVerified: true,
    },
  });
}

export async function CustomerHeader() {
  const [user, provider] = await Promise.all([getCurrentUser(), getPrimaryProvider()]);
  const tel = telLink(provider?.contactPhone);

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="MOYO home">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-white">
            <Icon name="bolt" size={20} />
          </span>
          <span className="text-lg font-bold tracking-tight text-ink-900">MOYO</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.href + item.label}
              href={item.href}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {tel && (
            <a
              href={tel}
              className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50 sm:inline-flex"
            >
              <Icon name="phone" size={16} />
              Call provider
            </a>
          )}

          {user ? (
            <Link
              href="/account"
              className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition hover:bg-ink-100"
              aria-label="Your account"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                {initials(user.name)}
              </span>
              <span className="hidden text-sm font-medium text-ink-700 sm:block">{user.name}</span>
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export async function BottomNav() {
  const user = await getCurrentUser();
  const items = [...BOTTOM_NAV, user ? ACCOUNT_NAV_SIGNED_IN : ACCOUNT_NAV_SIGNED_OUT];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Mobile navigation"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const isPrimary = item.label === 'Booking';
          return (
            <li key={item.label}>
              <Link
                href={item.href}
                className="flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium text-ink-500 transition hover:text-ink-700"
              >
                {isPrimary ? (
                  <span className="-mt-6 grid h-12 w-12 place-items-center rounded-full bg-brand-600 text-white shadow-raised ring-4 ring-white">
                    <Icon name="bolt" size={22} />
                  </span>
                ) : (
                  <Icon name={item.icon} size={20} />
                )}
                <span className={cn(isPrimary && '-mt-0.5')}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Footer. Presents MOYO as the service identity customers book with. */
export function CustomerFooter() {
  return (
    <footer className="border-t border-ink-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
                <Icon name="bolt" size={18} />
              </span>
              <span className="text-base font-bold text-ink-900">MOYO</span>
            </div>
            <p className="mt-3 text-sm text-ink-500">
              MOYO is a service operations platform delivering field services across 20 official
              categories.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            <FooterColumn
              title="Platform"
              links={[
                { href: '/categories', label: 'All categories' },
                { href: '/book', label: 'Book a service' },
                { href: '/bookings', label: 'My bookings' },
              ]}
            />
            <FooterColumn
              title="Account"
              links={[
                { href: '/login', label: 'Sign in' },
                { href: '/register', label: 'Create account' },
                { href: '/bookings', label: 'Booking history' },
              ]}
            />
            <FooterColumn
              title="Legal"
              links={[
                { href: '/terms', label: 'Terms & conditions' },
                { href: '/privacy', label: 'Privacy policy' },
              ]}
            />
          </div>
        </div>

        <p className="mt-8 border-t border-ink-200 pt-6 text-xs text-ink-400">
          © {new Date().getFullYear()} MOYO. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<{ href: string; label: string }>;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">{title}</h3>
      <ul className="mt-3 space-y-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-sm text-ink-600 transition hover:text-brand-600">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Provider contact block. Neutral copy when contact data is unavailable. */
export async function ProviderContactCard() {
  const provider = await getPrimaryProvider();
  if (!provider) return null;

  const tel = telLink(provider.contactPhone);
  const wa = whatsappLink(
    provider.whatsappNumber,
    'Hello, I would like to book a service on MOYO.',
  );
  return (
    <section className="rounded-card border border-ink-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-ink-900">Service provider</h2>
      <p className="mt-1 text-sm font-medium text-ink-700">{provider.displayName}</p>
      {provider.description && (
        <p className="mt-2 text-sm leading-relaxed text-ink-600">{provider.description}</p>
      )}

      <dl className="mt-4 space-y-2 text-sm">
        {provider.registeredAddress && (
          <div className="flex gap-2">
            <dt className="shrink-0 pt-0.5 text-ink-400">
              <Icon name="location" size={16} />
              <span className="sr-only">Registered address</span>
            </dt>
            <dd className="text-ink-600">{provider.registeredAddress}</dd>
          </div>
        )}
        {provider.serviceAreaCities && (
          <div className="flex gap-2">
            <dt className="shrink-0 pt-0.5 text-ink-400">
              <Icon name="location" size={16} />
              <span className="sr-only">Service areas</span>
            </dt>
            <dd className="text-ink-600">Service areas: {provider.serviceAreaCities}</dd>
          </div>
        )}
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        {tel && (
          <a
            href={tel}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-700"
          >
            <Icon name="phone" size={14} />
            Call
          </a>
        )}
        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1.5 rounded-lg bg-success px-3 py-2 text-xs font-semibold text-white transition hover:bg-success/90"
          >
            <Icon name="whatsapp" size={14} />
            WhatsApp
          </a>
        )}
      </div>
    </section>
  );
}