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
    <div className="bg-cream-50">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <header className="relative overflow-hidden rounded-3xl bg-night-950 p-7 text-white shadow-overlay sm:p-10">
          <div className="absolute inset-0 texture-dots opacity-60" aria-hidden />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gold-400 font-display text-xl font-semibold text-night-950">
                {profile.name.charAt(0).toUpperCase()}
              </span>
              <div>
                <p className="eyebrow text-gold-400">
                  <span className="h-px w-6 bg-gold-400" aria-hidden />
                  {roleLabel}
                </p>
                <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                  {profile.name}
                </h1>
                <p className="mt-1 text-xs text-white/60">
                  Member since {formatDate(profile.createdAt)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {isAdmin && (
                <Link
                  href="/admin"
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-bold text-white ring-1 ring-inset ring-white/25 transition hover:bg-white/20"
                >
                  <Icon name="grid" size={15} />
                  Admin Console
                </Link>
              )}
              <Link
                href="/bookings"
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-ink-900 transition hover:bg-gold-400 hover:text-night-950"
              >
                <Icon name="clipboard" size={15} />
                My bookings
              </Link>
            </div>
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
        className="mt-5 rounded-3xl border border-ink-200 bg-white p-6 shadow-card sm:p-7"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="recent-bookings-heading" className="font-display text-lg font-semibold text-ink-900">
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
                  className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated"
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

      <nav aria-label="Account shortcuts" className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      className="group rounded-3xl border border-ink-200 bg-white p-5 shadow-card transition-all duration-300 hover:border-brand-300 hover:shadow-elevated hover:-translate-y-1"
    >
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-ink-900 text-gold-400 transition-colors duration-300 group-hover:bg-brand-600 group-hover:text-white">
        <Icon name={icon} size={20} />
      </span>
      <h2 className="mt-3 font-display text-[17px] font-semibold text-ink-900 group-hover:text-brand-700">{title}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-500">{description}</p>
    </Link>
  );
}

function SignOutCard() {
  return (
    <div className="group rounded-3xl border border-ink-200 bg-white p-5 shadow-card transition-all duration-300 hover:border-brand-300 hover:shadow-elevated hover:-translate-y-1">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-ink-900 text-gold-400 transition-colors duration-300 group-hover:bg-brand-600 group-hover:text-white">
        <Icon name="logout" size={20} />
      </span>
      <h2 className="mt-3 font-display text-[17px] font-semibold text-ink-900 group-hover:text-brand-700">
        Sign out
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
        End this session on this device.
      </p>
      <div className="mt-4">
        <AccountSignOutButton />
      </div>
    </div>
  );
}
