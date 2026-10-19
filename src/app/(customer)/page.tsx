import Link from 'next/link';
import Image from 'next/image';
import { Icon } from '@/components/ui/Icon';
import { ServiceCard } from '@/components/customer/Cards';
import { CategoryMarquee, CategoryMosaicTile } from '@/components/customer/Showcase';
import { ProviderContactCard } from '@/components/customer/Shell';
import { JourneyLine, type JourneyStep } from '@/components/customer/JourneyLine';
import { listCategories } from '@/lib/queries';
import { getCurrentUser } from '@/lib/auth';
import { CHARGING_HINT, CHARGING_LABEL, CHARGING_OPTIONS } from '@/lib/domain';
import { prisma } from '@/lib/prisma';

export const metadata = {
  title: 'Seric Tech Solutions - Book technology services',
  description:
    'Seric Tech Solutions is a technology services platform for booking, tracking and managing field services across 20 service categories.',
};

/**
 * The real booking journey, in order: category -> service -> charging option ->
 * tracking. Every description states only what the application actually does -
 * no ETAs, no fabricated availability.
 */
const BOOKING_JOURNEY: JourneyStep[] = [
  {
    icon: 'grid',
    title: 'Find the right category',
    description:
      'Twenty official service categories cover home, office, solar, plumbing, painting and more. Search, or browse to the exact job.',
  },
  {
    icon: 'list',
    title: 'Compare services and honest prices',
    description:
      'Each service lists its included work and the prices the provider has actually published. Where a price is not published, we say so instead of inventing one.',
  },
  {
    icon: 'wallet',
    title: 'Choose how you want to be charged',
    description:
      'Visit charge, fixed charge, or set your own budget. The server prices the booking from catalogue rules - the browser can never post a price.',
  },
  {
    icon: 'clipboard',
    title: 'Book and track to completion',
    description:
      'Your booking reference follows the job from request through confirmation, the on-site states, invoice and feedback - all from My bookings.',
  },
];

/**
 * SERIC TECH SOLUTIONS CUSTOMER HOMEPAGE
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

  const totalServices = categories.reduce((n, c) => n + c.serviceCount, 0);
  const recommended = featured.slice(0, 4);

  return (
    <>
      <HeroSection categoryCount={categories.length} totalServices={totalServices} />

      {activeBooking && <CurrentBookingBanner booking={activeBooking} />}

      <CategoryMarquee categories={categories} />

      <section className="bg-cream-50">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between reveal">
            <div className="max-w-2xl">
              <p className="eyebrow text-brand-600">
                <span className="h-px w-8 bg-brand-600" aria-hidden />
                Service catalog
              </p>
              <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
                A marketplace of real field crafts
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-500 sm:text-base">
                {categories.length} official categories · {totalServices} live services.
              </p>
            </div>
            <Link
              href="/categories"
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-ink-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-600"
            >
              View all categories <Icon name="chevron-right" size={16} />
            </Link>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-4 reveal">
            {categories.slice(0, 7).map((category, i) => (
              <CategoryMosaicTile
                key={category.id}
                category={category}
                size={i < 2 ? 'lead' : i === 2 ? 'tall' : 'standard'}
              />
            ))}
            <Link
              href="/categories"
              className="group relative flex min-h-[220px] flex-col justify-between overflow-hidden rounded-3xl bg-night-900 p-6 text-white shadow-raised transition-all duration-500 hover:-translate-y-1.5 hover:shadow-overlay"
            >
              <span className="absolute inset-0 texture-lines" aria-hidden />
              <span className="relative font-display text-6xl font-semibold text-white/20 transition group-hover:text-gold-400/60">
                +{Math.max(0, categories.length - 7)}
              </span>
              <span className="relative">
                <span className="block font-display text-2xl font-semibold leading-tight">
                  See the full catalog
                </span>
                <span className="mt-2 inline-flex items-center gap-2 text-sm font-bold text-gold-400">
                  All {categories.length} categories <Icon name="chevron-right" size={16} />
                </span>
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-night-950 text-white">
        <div className="absolute inset-0 texture-dots opacity-60" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 reveal">
          <p className="eyebrow text-gold-400">
            <span className="h-px w-8 bg-gold-400" aria-hidden />
            Popular services
          </p>
          <h2 className="mt-3 max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-5xl">
            Booked often, priced honestly
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((service) => (
              <ServiceCard key={service.id} service={service} />
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-ink-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.4fr] lg:px-8">
          <div className="lg:sticky lg:top-24 lg:self-start reveal">
            <p className="eyebrow text-brand-600">
              <span className="h-px w-8 bg-brand-600" aria-hidden />
              Transparent pricing
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
              How charging works
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-500">
              Every booking uses one of three options. You choose before confirming.
            </p>
            <Link
              href="/book"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700"
            >
              <Icon name="bolt" size={16} /> Start a booking
            </Link>
          </div>
          <div className="space-y-4">
            {CHARGING_OPTIONS.map((option, index) => (
              <article
                key={option}
                className="rounded-3xl border border-ink-200 bg-ink-50/60 p-6 transition hover:shadow-elevated sm:p-7"
              >
                <div className="flex items-start gap-4">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-ink-900 font-display text-lg font-semibold text-white">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="font-display text-xl font-semibold text-ink-900">
                      {CHARGING_LABEL[option]}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-ink-600">
                      {CHARGING_HINT[option]}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="journey-heading" className="relative overflow-hidden bg-cream-50">
        <div className="relative mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div className="mx-auto max-w-2xl text-center reveal">
            <p className="eyebrow justify-center text-brand-600">
              <span className="h-px w-8 bg-brand-600" aria-hidden />
              The journey
              <span className="h-px w-8 bg-brand-600" aria-hidden />
            </p>
            <h2
              id="journey-heading"
              className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-5xl"
            >
              From problem to finished job
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-500">
              Four steps, one booking reference. Scroll to draw the line.
            </p>
          </div>
          <JourneyLine steps={BOOKING_JOURNEY} className="mt-4" />
        </div>
      </section>

      {recommended.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 reveal">
          <div className="overflow-hidden rounded-3xl bg-ink-900 text-white shadow-overlay">
            <div className="grid lg:grid-cols-2">
              <div className="relative p-8 sm:p-12">
                <div className="absolute inset-0 texture-lines" aria-hidden />
                <div className="relative">
                  <p className="eyebrow text-gold-400">
                    <span className="h-px w-8 bg-gold-400" aria-hidden />
                    Recommended
                  </p>
                  <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                    Start with what India books most
                  </h2>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link
                      href="/categories"
                      className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-ink-900 transition hover:bg-gold-400"
                    >
                      Browse categories <Icon name="chevron-right" size={16} />
                    </Link>
                    <Link
                      href="/search"
                      className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-white ring-1 ring-inset ring-white/30 transition hover:bg-white/10"
                    >
                      <Icon name="search" size={16} /> Search services
                    </Link>
                  </div>
                </div>
              </div>
              <ul className="divide-y divide-white/10 bg-white/[0.03]">
                {recommended.map((service, i) => (
                  <li key={service.id}>
                    <Link
                      href={`/services/${service.slug}`}
                      className="group flex items-center gap-4 p-5 transition hover:bg-white/[0.06] sm:p-6"
                    >
                      <span className="font-display text-3xl font-semibold text-white/25 transition group-hover:text-gold-400">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-white sm:text-base">
                          {service.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-white/60">
                          {service.categoryName}
                        </span>
                      </span>
                      <Icon
                        name="chevron-right"
                        size={18}
                        className="shrink-0 text-white/40 transition-all group-hover:translate-x-1 group-hover:text-gold-400"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      <section className="border-t border-ink-200 bg-white">
        <div className="mx-auto grid max-w-7xl items-start gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.2fr_0.8fr] lg:px-8">
          <div className="reveal">
            <p className="eyebrow text-brand-600">
              <span className="h-px w-8 bg-brand-600" aria-hidden />
              Trust & support
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
              Run by Seric Tech Solutions, backed by the record
            </h2>
            <ul className="mt-8 space-y-5">
              <li className="flex gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-ink-900 text-gold-400">
                  <Icon name="receipt" size={19} />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-ink-900">Every booking carries a reference</h3>
                  <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-500">
                    Follow each job from request through confirmation and the on-site
                    states to invoice and feedback — all from My bookings.
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-ink-900 text-gold-400">
                  <Icon name="wallet" size={19} />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-ink-900">Prices come from the catalogue</h3>
                  <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-500">
                    Services show the lowest published price per charging option. Where a
                    price is not published, the page says so instead of inventing one.
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-ink-900 text-gold-400">
                  <Icon name="shield" size={19} />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-ink-900">Contact details are real</h3>
                  <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-500">
                    Call or message the provider directly with the published number — or
                    open My bookings to follow the job.
                  </p>
                </div>
              </li>
            </ul>
          </div>
          <div className="reveal-slow">
            <ProviderContactCard />
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-night-950 text-white">
        <div className="absolute inset-0 texture-dots opacity-60" aria-hidden />
        <div className="absolute left-1/2 top-0 h-px w-2/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-gold-400/70 to-transparent" aria-hidden />
        <div className="relative mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <p className="eyebrow justify-center text-gold-400">
            <span className="h-px w-8 bg-gold-400" aria-hidden />
            Ready when you are
            <span className="h-px w-8 bg-gold-400" aria-hidden />
          </p>
          <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-5xl">
            Your next job starts with one search
          </h2>
          <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
            <Link
              href="/categories"
              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-white px-7 py-3 text-sm font-bold leading-5 text-ink-900 transition hover:bg-gold-400 hover:text-night-950 sm:w-auto"
            >
              <Icon name="bolt" size={16} className="shrink-0" />
              <span className="whitespace-nowrap">Browse categories</span>
            </Link>
            <Link
              href="/book"
              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full px-7 py-3 text-sm font-bold leading-5 text-white ring-1 ring-inset ring-white/30 transition hover:bg-white/10 sm:w-auto"
            >
              <Icon name="clipboard" size={16} className="shrink-0" />
              <span className="whitespace-nowrap">Start a booking</span>
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

function HeroSection({ categoryCount, totalServices }: { categoryCount: number; totalServices: number }) {
  return (
    <section className="relative overflow-hidden bg-night-950 text-white">
      <div className="absolute inset-0 texture-dots opacity-70" aria-hidden />
      <div className="absolute -left-32 top-1/3 h-96 w-96 rounded-full bg-brand-600/25 blur-3xl" aria-hidden />
      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:pb-28 lg:pt-20">
        <div className="reveal">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-white ring-1 ring-inset ring-white/20">
            <Image src="/brand/seric-tech-symbol.png" alt="" width={623} height={523} className="h-4 w-4 shrink-0 object-contain" />
            {categoryCount} categories · {totalServices} services
          </p>
          <h1 className="mt-6 font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            Innovative Technology for a Smarter Tomorrow.
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">
            Book technology services, field work, and technical support across {categoryCount} official service
            categories. Choose a service, pick how you want to be charged, and follow your booking from request
            through to completion.
          </p>

          <form action="/search" method="get" role="search" className="mt-7 max-w-xl">
            <label htmlFor="hero-search" className="sr-only">Search services</label>
            <div className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 p-2 pl-4 backdrop-blur transition focus-within:border-gold-400/60">
              <Icon name="search" size={17} className="shrink-0 text-white/60" />
              <input
                id="hero-search"
                type="search"
                name="q"
                maxLength={80}
                autoComplete="off"
                placeholder="Try plumbing, solar, painting…"
                className="w-full min-w-0 bg-transparent text-sm text-white placeholder:text-white/45 focus:outline-none"
              />
              <button
                type="submit"
                className="shrink-0 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-ink-900 transition hover:bg-gold-400"
              >
                Search
              </button>
            </div>
          </form>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Link
              href="/categories"
              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-brand-600 px-6 py-3 text-sm font-bold leading-5 text-white transition hover:bg-brand-500 sm:w-auto"
            >
              <Image src="/brand/seric-tech-symbol.png" alt="" width={623} height={523} className="h-4 w-4 shrink-0 object-contain" />
              <span className="whitespace-nowrap">Browse categories</span>
            </Link>
            <Link
              href="/book"
              className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full px-6 py-3 text-sm font-bold leading-5 text-white ring-1 ring-inset ring-white/25 transition hover:bg-white/10 sm:w-auto"
            >
              <Icon name="clipboard" size={16} className="shrink-0" />
              <span className="whitespace-nowrap">Start a booking</span>
            </Link>
          </div>
        </div>

        <div className="reveal-slow pb-10 lg:pb-0">
          <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden>
            <div className="hero-float relative overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-brand-600 via-brand-800 to-night-900 p-6 shadow-overlay">
              <div className="absolute inset-0 texture-dots" aria-hidden />
              <div className="relative">
                <p className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white ring-1 ring-inset ring-white/25">
                  <Image src="/brand/seric-tech-symbol.png" alt="" width={623} height={523} className="h-3 w-3 shrink-0 object-contain" /> Live catalogue
                </p>
                <p className="mt-4 font-display text-3xl font-semibold leading-tight text-white">
                  Every job,
                  <br />
                  one reference.
                </p>
                <div className="mt-5 space-y-2.5 text-sm font-semibold">
                  <div className="flex items-center gap-3 rounded-2xl bg-white/12 px-3.5 py-2.5 text-white ring-1 ring-inset ring-white/15">
                    <Icon name="search" size={16} /> Find the exact service
                  </div>
                  <div className="flex items-center gap-3 rounded-2xl bg-white/12 px-3.5 py-2.5 text-white ring-1 ring-inset ring-white/15">
                    <Icon name="wallet" size={16} /> Honest published pricing
                  </div>
                  <div className="flex items-center gap-3 rounded-2xl bg-gold-400/90 px-3.5 py-2.5 text-night-950">
                    <Icon name="clipboard" size={16} /> Track request to feedback
                  </div>
                </div>
              </div>
            </div>
            <div className="hero-float-delayed absolute -bottom-8 -left-2 flex items-center gap-3 rounded-2xl border border-white/40 bg-white/95 px-4 py-3 text-ink-900 shadow-overlay sm:-left-6">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white">
                <Icon name="shield" size={20} />
              </span>
              <span>
                <span className="block text-sm font-bold">Server-priced bookings</span>
                <span className="block text-xs text-ink-500">The browser can never post a price</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="relative border-t border-white/10 bg-white/[0.03]">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 text-xs text-white/70 sm:grid-cols-3 sm:px-6 lg:px-8">
          <p className="flex items-start gap-2">
            <Icon name="check-circle" size={15} className="mt-0.5 shrink-0 text-gold-400" />
            Pricing shown per charging option, published by the provider
          </p>
          <p className="flex items-start gap-2">
            <Icon name="check-circle" size={15} className="mt-0.5 shrink-0 text-gold-400" />
            Technician details appear after assignment
          </p>
          <p className="flex items-start gap-2">
            <Icon name="check-circle" size={15} className="mt-0.5 shrink-0 text-gold-400" />
            Payment status confirmed by the payment provider
          </p>
        </div>
      </div>
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