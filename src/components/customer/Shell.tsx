import Link from 'next/link';
import Image from 'next/image';
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
 * go to `/login?next=%2Faccount` so the requested page survives the login hop.
 * BottomNav is a server component so it can read the session.
 */
const BOTTOM_NAV: NavItem[] = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/categories', label: 'Menu', icon: 'grid' },
  { href: '/book', label: 'Booking', icon: 'bolt' },
  { href: '/bookings', label: 'Bookings', icon: 'clipboard' },
];

/**
 * Account destination: personal page when signed in, login otherwise.
 * The anonymous entry preserves `/account` as a safe `next` so a successful
 * login returns the visitor to the page they asked for.
 */
const ACCOUNT_NAV_SIGNED_IN: NavItem = { href: '/account', label: 'Account', icon: 'user' };
const ACCOUNT_NAV_SIGNED_OUT: NavItem = {
  href: '/login?next=%2Faccount',
  label: 'Account',
  icon: 'user',
};

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
    <header className="sticky top-0 z-40 border-b border-ink-200/80 bg-night-950 text-white shadow-card">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5"
          aria-label="Seric Tech Solutions home"
        >
          {/*
            Approved header brand mark: favicon/Transparent.png copied to
            public/brand/seric-tech-solutions-logo.png (500x500, transparent
            square canvas). Rendered in a fixed square with `object-contain`
            so the intrinsic aspect ratio is never distorted by header layout.
          */}
          <Image
            src="/brand/seric-tech-solutions-logo.png"
            alt="Seric Tech Solutions logo"
            width={500}
            height={500}
            priority
            className="h-9 w-9 shrink-0 object-contain"
          />
          <span className="hidden whitespace-nowrap text-sm font-semibold text-white sm:block lg:text-base">
            Seric Tech Solutions
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {PRIMARY_NAV.map((item) => (
            <Link
              key={item.href + item.label}
              href={item.href}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium text-white/75 transition-all hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-night-950"
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </Link>
          ))}
        </nav>

        {/*
          Catalogue search: a plain GET form to /search, so it works without
          hydration and every result URL is shareable. Deliberately a <form>
          rather than a <Link> - the anchor-based navigation contract asserted
          in tests/navigation.test.ts collects href props only, and forms
          carry action, not href.
        */}
        <form
          action="/search"
          method="get"
          role="search"
          className="ml-auto w-full min-w-0 max-w-md flex-1"
        >
          <label htmlFor="header-search" className="sr-only">
            Search services
          </label>
          <div className="relative">
            <Icon
              name="search"
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50"
            />
            <input
              id="header-search"
              type="search"
              name="q"
              placeholder="Search services…"
              maxLength={80}
              autoComplete="off"
              className="w-full rounded-full border border-white/15 bg-white/10 py-2 pl-9 pr-3 text-sm text-white transition placeholder:text-white/45 focus:border-gold-400/60 focus:bg-white/15 focus:outline-none"
            />
          </div>
        </form>

        <div className="flex shrink-0 items-center gap-3">
          {tel && (
            <a
              href={tel}
              className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-white/80 ring-1 ring-inset ring-white/20 transition-all hover:bg-white/10 hover:text-white sm:inline-flex focus-visible:ring-2 focus-visible:ring-gold-400"
            >
              <Icon name="phone" size={16} />
              Call provider
            </a>
          )}

          {user ? (
            <Link
              href="/account"
              className="flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-2.5 transition-all hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-night-950"
              aria-label="Your account"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-gold-400 text-xs font-bold text-night-950">
                {initials(user.name)}
              </span>
              <span className="hidden text-sm font-medium text-white sm:block">{user.name}</span>
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-full bg-white px-4 py-2 text-sm font-bold text-ink-900 transition-all hover:bg-gold-400 hover:text-night-950 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-night-950"
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 shadow-elevated pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Mobile navigation"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const isPrimary = item.label === 'Booking';
          return (
            <li key={item.label}>
              <Link
                href={item.href}
                className={cn(
                  'flex flex-col items-center justify-center gap-1.5 py-3 text-[10px] font-medium transition-all duration-200',
                  isPrimary ? 'text-brand-600' : 'text-ink-500 hover:text-brand-600'
                )}
              >
                {isPrimary ? (
                  <span className="-mt-6 grid h-12 w-12 place-items-center rounded-full bg-brand-600 text-white shadow-raised ring-4 ring-white scale-105">
                    <Icon name="bolt" size={22} />
                  </span>
                ) : (
                  <Icon name={item.icon} size={20} className="hover:text-brand-600 transition-colors duration-200" />
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

/** Footer. Presents Seric Tech Solutions as the service identity customers book with. */
export function CustomerFooter() {
  return (
    <footer className="relative overflow-hidden bg-night-950 text-white">
      <div className="absolute inset-0 texture-dots opacity-50" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-3">
              <Image
                src="/brand/seric-tech-solutions-logo.png"
                alt=""
                width={500}
                height={500}
                className="h-11 w-11 shrink-0 object-contain"
              />
              <span className="font-display text-lg font-semibold tracking-tight text-white sm:whitespace-nowrap lg:text-xl">
                Seric Tech Solutions
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-white/65">
              Seric Tech Solutions is a technology services platform delivering field services across 20 official
              categories.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href="/book"
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-ink-900 transition hover:bg-gold-400 hover:text-night-950"
              >
                <Icon name="bolt" size={14} /> Book a service
              </Link>
              <Link
                href="/categories"
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold text-white ring-1 ring-inset ring-white/25 transition hover:bg-white/10"
              >
                All categories
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:grid-cols-4">
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

        <p className="mt-10 border-t border-white/10 pt-6 text-xs text-white/45">
          © {new Date().getFullYear()} Seric Tech Solutions. All rights reserved.
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
      <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-3">{title}</h3>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="text-sm text-white/70 transition-all duration-200 hover:text-gold-400 hover:pl-1"
            >
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
    'Hello, I would like to book a service on Seric Tech Solutions.',
  );
  return (
    <section className="rounded-card border border-ink-200 bg-white p-6 shadow-card transition-all hover:shadow-raised">
      <div className="flex items-center gap-3 mb-4">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600">
          <Icon name="bolt" size={20} />
        </span>
        <h2 className="text-sm font-semibold text-ink-900">Service provider</h2>
      </div>
      <p className="mt-0.5 text-sm font-medium text-ink-700">{provider.displayName}</p>
      {provider.description && (
        <p className="mt-2 text-sm leading-relaxed text-ink-600">{provider.description}</p>
      )}

      <dl className="mt-5 space-y-3 text-sm">
        {provider.registeredAddress && (
          <div className="flex gap-3">
            <dt className="shrink-0 pt-0.5 text-ink-400">
              <Icon name="location" size={16} />
              <span className="sr-only">Registered address</span>
            </dt>
            <dd className="text-ink-600 leading-relaxed">{provider.registeredAddress}</dd>
          </div>
        )}
        {provider.serviceAreaCities && (
          <div className="flex gap-3">
            <dt className="shrink-0 pt-0.5 text-ink-400">
              <Icon name="location" size={16} />
              <span className="sr-only">Service areas</span>
            </dt>
            <dd className="text-ink-600">Service areas: {provider.serviceAreaCities}</dd>
          </div>
        )}
      </dl>

      <div className="mt-5 flex flex-wrap gap-2">
        {tel && (
          <a
            href={tel}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
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
            className="inline-flex items-center gap-1.5 rounded-xl bg-success px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-success/90 focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            <Icon name="whatsapp" size={14} />
            WhatsApp
          </a>
        )}
      </div>
    </section>
  );
}