import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { CategoryCard, ServiceCard } from '@/components/customer/Cards';
import { ProviderContactCard } from '@/components/customer/Shell';
import { listCategories } from '@/lib/queries';
import { getCurrentUser } from '@/lib/auth';
import { CHARGING_HINT, CHARGING_LABEL, CHARGING_OPTIONS } from '@/lib/domain';
import { prisma } from '@/lib/prisma';

export const metadata = {
  title: 'MOYO - Book field services',
  description:
    'MOYO is a service operations platform for booking, tracking and managing field services across 20 service categories.',
};

/**
 * MOYO CUSTOMER HOMEPAGE
 *
 * Nothing on this page asserts an operational fact that is not in the database.
 * Where a value is unknown (a price, a rating, technician availability) the UI
 * says so plainly instead of inventing one.
 */
export default async function HomePage() {
  const [categories, user, featured] = await Promise.all([
    listCategories(),
    getCurrentUser(),
    getFeaturedServices(),
  ]);

  const activeBooking = user ? await getActiveBookingSummary(user.id) : null;

  return (
    <>
      <HeroSection categoryCount={categories.length} />

      {activeBooking && <CurrentBookingBanner booking={activeBooking} />}

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 reveal">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
              Service catalog
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-ink-900">
              Browse service categories
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              {categories.length} official categories, each with its own service list.
            </p>
          </div>
          <Link
            href="/categories"
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 transition hover:text-brand-700"
          >
            View all
            <Icon name="chevron-right" size={16} />
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.slice(0, 9).map((category) => (
            <CategoryCard key={category.id} category={category} />
          ))}
        </div>
      </section>

      <section className="border-y border-ink-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 reveal">
          <h2 className="text-2xl font-bold tracking-tight text-ink-900">How charging works</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            Every booking uses one of three charging options. You choose before confirming.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {CHARGING_OPTIONS.map((option, index) => (
              <article
                key={option}
                className="group rounded-xl border border-ink-200 bg-white p-6 shadow-card transition-all duration-300 hover:shadow-elevated hover:-translate-y-0.5"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700 transition-colors duration-300 group-hover:bg-brand-600 group-hover:text-white">
                    {index + 1}
                  </span>
                  <h3 className="text-sm font-semibold text-ink-900">{CHARGING_LABEL[option]}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-ink-600">{CHARGING_HINT[option]}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {featured.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 reveal">
          <h2 className="text-2xl font-bold tracking-tight text-ink-900">Popular services</h2>
          <p className="mt-1 text-sm text-ink-500">
            A sample of the services available across all categories.
          </p>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((service) => (
              <ServiceCard key={service.id} service={service} />
            ))}
          </div>
        </section>
      )}

      <section className="border-t border-ink-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-14 sm:px-6 lg:grid-cols-3 lg:px-8 reveal">
          <ProviderContactCard />

          <div className="group rounded-xl border border-ink-200 bg-white p-6 shadow-card transition-all duration-300 hover:shadow-elevated hover:-translate-y-0.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-ink-900 text-white">
              <Icon name="package" size={16} />
            </div>
            <h2 className="mt-3 text-sm font-semibold text-ink-900">Order materials</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">
              Category 20 covers new material ordering. Browse available materials and place an
              order with delivery details. Installation can be requested alongside.
            </p>
            <Link
              href="/orders"
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-ink-900 px-4 py-2 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-ink-800 hover:shadow-elevated"
            >
              <Icon name="package" size={16} />
              Order materials
            </Link>
          </div>

          <div className="group rounded-xl border border-ink-200 bg-white p-6 shadow-card transition-all duration-300 hover:shadow-elevated hover:-translate-y-0.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-ink-900 text-white">
              <Icon name="message" size={16} />
            </div>
            <h2 className="mt-3 text-sm font-semibold text-ink-900">Need help?</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">
              Open a support request from your account, or call the provider directly using the
              contact details published on this page.
            </p>
            <Link
              href="/support"
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-ink-900 px-4 py-2 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-ink-800 hover:shadow-elevated"
            >
              <Icon name="message" size={16} />
              Contact support
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function HeroSection({ categoryCount }: { categoryCount: number }) {
  return (
    <section className="relative overflow-hidden border-b border-ink-800 bg-ink-900 text-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-20">
        <div className="max-w-3xl reveal">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-100">
            <Icon name="bolt" size={12} />
            {categoryCount} service categories
          </p>

          <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            Book, track and manage field services on MOYO
          </h1>

          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300 sm:text-base">
            Choose a category, select a service, pick how you want to be charged, and follow the
            booking from request through invoice to feedback.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/categories"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated"
            >
              <Icon name="bolt" size={16} />
              Book a service
            </Link>
            <Link
              href="/bookings"
              className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-5 py-3 text-sm font-semibold text-white ring-1 ring-inset ring-white/20 shadow-card transition-all duration-300 hover:bg-white/20 hover:shadow-elevated"
            >
              <Icon name="clipboard" size={16} />
              Track a booking
            </Link>
          </div>

          {/*
            Honest operating notes. No invented guarantees, no fake ETAs.
          */}
          <ul className="reveal-slow mt-8 grid gap-4 text-sm text-ink-300 sm:grid-cols-3">
            <li className="flex items-start gap-2">
              <Icon name="check-circle" size={16} className="mt-0.5 shrink-0 text-success" />
              Pricing shown per charging option, published by the provider
            </li>
            <li className="flex items-start gap-2">
              <Icon name="check-circle" size={16} className="mt-0.5 shrink-0 text-success" />
              Technician details appear after assignment
            </li>
            <li className="flex items-start gap-2">
              <Icon name="check-circle" size={16} className="mt-0.5 shrink-0 text-success" />
              Payment status confirmed by the payment provider
            </li>
          </ul>
        </div>
      </div>

      {/* Subtle depth layer behind hero */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_80%_-10%,var(--color-brand-900)_0%,var(--color-ink-900)_60%)] opacity-60" />
    </section>
  );
}

function CurrentBookingBanner({
  booking,
}: {
  booking: { id: string; reference: string; serviceName: string; status: string };
}) {
  return (
    <section className="border-b border-brand-200 bg-brand-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-600 text-white">
            <Icon name="clipboard" size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-900">
              You have an active booking
            </p>
            <p className="truncate text-xs text-ink-600">
              {booking.reference} &middot; {booking.serviceName}
            </p>
          </div>
        </div>
        <Link
          href={`/bookings/${booking.id}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated"
        >
          View status
          <Icon name="chevron-right" size={16} />
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Data helpers - every value is read from the database, never fabricated
// ---------------------------------------------------------------------------

async function getFeaturedServices() {
  const rows = await prisma.service.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    take: 8,
    select: {
      id: true,
      name: true,
      slug: true,
      serviceType: true,
      description: true,
      options: { where: { isActive: true }, select: { pricePaise: true } },
      subCategory: { select: { category: { select: { name: true, slug: true } } } },
    },
  });

  return rows.map((r) => {
    const priced = r.options.map((o) => o.pricePaise).filter((p): p is number => p != null && p > 0);
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      serviceType: r.serviceType,
      description: r.description,
      categoryName: r.subCategory.category.name,
      categorySlug: r.subCategory.category.slug,
      priceFromPaise: priced.length > 0 ? Math.min(...priced) : null,
    };
  });
}

/** Most recent booking that has not reached a terminal state. */
async function getActiveBookingSummary(customerId: string) {
  const booking = await prisma.booking.findFirst({
    where: {
      customerId,
      status: {
        notIn: ['CLOSED', 'CANCELLED'],
      },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      reference: true,
      status: true,
      service: { select: { name: true } },
    },
  });

  if (!booking) return null;
  return {
    id: booking.id,
    reference: booking.reference,
    serviceName: booking.service.name,
    status: booking.status,
  };
}