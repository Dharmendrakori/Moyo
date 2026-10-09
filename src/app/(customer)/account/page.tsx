import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountManager, AccountSignOutButton } from '@/components/customer/AccountManager';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/States';
import { getCurrentUser } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/domain';
import { formatDate } from '@/lib/format';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = {
  title: 'My account',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * PERSONAL ACCOUNT
 *
 * Every authenticated user - CUSTOMER, PROVIDER, TECHNICIAN *and* ADMIN -
 * owns this page. It is the personal account surface, deliberately separate
 * from the Admin Console (`/admin`):
 *
 * - Anonymous visitors go to `/login?next=/account`.
 * - No authenticated role is ever bounced to `/admin` from here. The
 *   post-login *landing* decision (homepage-first: `/` for every role) lives
 *   in `resolvePostLoginRedirect` and is a different concern from this
 *   *navigation* destination: an admin who explicitly opens Account must
 *   reach their own profile, not the console.
 * - Every query is scoped to the session user's OWN id. Only real data
 *   renders; an empty history shows an honest empty state, never invented rows.
 */
export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=%2Faccount');
  const [profile, recentBookings, bookingTotal] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        createdAt: true, lastLoginAt: true,
        address: {
          select: {
            label: true, line1: true, line2: true, landmark: true, area: true,
            city: true, state: true, pincode: true,
          },
        },
      },
    }),
    prisma.booking.findMany({
      where: { customerId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: {
        id: true, reference: true, status: true, createdAt: true,
        service: { select: { name: true } },
      },
    }),
    prisma.booking.count({ where: { customerId: user.id } }),
  ]);

  if (!profile || profile.id !== user.id) redirect('/login?next=%2Faccount');

  const roleLabel = ROLE_LABEL[user.role as keyof typeof ROLE_LABEL] ?? user.role;
  const isAdmin = user.role === 'ADMIN';

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">My account</h1>
          <p className="mt-1 text-sm text-ink-500">
            {roleLabel} &middot; Member since {formatDate(profile.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Link
              href="/admin"
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-800"
            >
              <Icon name="grid" size={16} />
              Admin Console
            </Link>
          )}
          <Link
            href="/categories"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            <Icon name="bolt" size={16} />
            Back to services
          </Link>
          <Link
            href="/bookings"
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
          >
            <Icon name="clipboard" size={16} />
            My bookings
          </Link>
        </div>
      </header>

      <AccountManager
        profile={{
          name: profile.name,
          email: profile.email,
          phone: profile.phone,
          role: user.role,
          roleLabel,
          createdAt: profile.createdAt.toISOString(),
          lastLoginAt: profile.lastLoginAt ? profile.lastLoginAt.toISOString() : null,
        }}
        address={
          profile.address
            ? {
                label: profile.address.label,
                line1: profile.address.line1,
                line2: profile.address.line2,
                landmark: profile.address.landmark,
                area: profile.address.area,
                city: profile.address.city,
                state: profile.address.state,
                pincode: profile.address.pincode,
              }
            : null
        }
      />

      <section
        aria-labelledby="recent-bookings-heading"
        className="mt-4 rounded-card border border-ink-200 bg-white p-5"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="recent-bookings-heading" className="text-sm font-semibold text-ink-900">
            Recent activity
          </h2>
          {bookingTotal > 0 && (
            <Link
              href="/bookings"
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 transition hover:text-brand-700"
            >
              View all ({bookingTotal})
              <Icon name="chevron-right" size={16} />
            </Link>
          )}
        </div>
          {recentBookings.length === 0 ? (
            <EmptyState
              icon="clipboard"
              title="No bookings yet"
              description="Browse the service catalogue to place your first booking."
              action={
                <Link
                  href="/categories"
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
                >
                  Browse services
                </Link>
              }
              className="py-8"
            />
          ) : (
            <ul className="mt-4 divide-y divide-ink-100">
              {recentBookings.map((booking) => (
                <li key={booking.id}>
                  <Link
                    href={`/bookings/${booking.id}`}
                    className="group flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-900 group-hover:text-brand-700">
                        {booking.service.name}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-ink-500">
                        {booking.reference} &middot; {formatDate(booking.createdAt)}
                      </p>
                    </div>
                    <Icon
                      name="chevron-right"
                      size={16}
                      className="shrink-0 text-ink-300 transition group-hover:text-brand-600"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

      <nav aria-label="Account shortcuts" className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <ShortcutCard
          href="/bookings"
          icon="clipboard"
          title="My bookings"
          description={
            bookingTotal === 0
              ? 'Track service requests once you book.'
              : `${bookingTotal} ${bookingTotal === 1 ? 'booking' : 'bookings'} in total.`
          }
        />
        <ShortcutCard
          href="/categories"
          icon="grid"
          title="Service catalogue"
          description="Browse categories and book a service."
        />
        <ShortcutCard
          href="/book"
          icon="bolt"
          title="Book a service"
          description="Start a new booking in a few steps."
        />
        <SignOutCard />
      </nav>
    </div>
  );
}

function ShortcutCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: 'clipboard' | 'grid' | 'bolt';
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-card border border-ink-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-raised"
    >
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-700">
        <Icon name={icon} size={20} />
      </span>
      <h2 className="mt-3 text-sm font-semibold text-ink-900 group-hover:text-brand-700">{title}</h2>
      <p className="mt-1 text-sm text-ink-500">{description}</p>
    </Link>
  );
}

function SignOutCard() {
  return (
    <div className="rounded-card border border-ink-200 bg-white p-5">
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-ink-100 text-ink-500">
        <Icon name="logout" size={20} />
      </span>
      <h2 className="mt-3 text-sm font-semibold text-ink-900">Sign out</h2>
      <p className="mt-1 text-sm text-ink-500">End this session on this device.</p>
      <div className="mt-3">
        <AccountSignOutButton />
      </div>
    </div>
  );
}
