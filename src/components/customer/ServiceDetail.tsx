import Link from 'next/link';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/States';
import {
  CHARGING_HINT,
  CHARGING_LABEL,
  CHARGING_OPTIONS,
  SERVICE_TYPE_LABEL,
  toChargingOption,
  type ServiceType,
} from '@/lib/domain';
import { formatDate, formatINR, telLink, whatsappLink } from '@/lib/format';
import type { ServiceDetail } from '@/lib/queries';

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  customer: { name: string };
};

/**
 * SERVICE DETAIL VIEW
 *
 * Shows only what the provider has actually published. Where a price, rating or
 * availability is unknown, the copy says so rather than inventing a value.
 */
export function ServiceDetailView({
  service,
  reviews,
}: {
  service: ServiceDetail;
  reviews: Review[];
}) {
  const optionsByCharging = new Map(
    service.options.map((o) => [toChargingOption(o.charging), o]),
  );

  const wa = whatsappLink(
    service.provider?.whatsappNumber,
    `Hello, I would like to book "${service.name}" on MOYO.`,
  );
  const tel = telLink(service.provider?.contactPhone);
  const avg = service.rating?.average ?? 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Breadcrumbs
        trail={[
          { label: 'Home', href: '/' },
          { label: 'Categories', href: '/categories' },
          { label: service.categoryName, href: `/categories/${service.categorySlug}` },
          { label: service.name },
        ]}
      />

      <div className="grid items-start gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {/*
            Premium hero card: oversized icon tile + title + provider/rating meta.
            Sticky panel aside carries the booking action.
          */}
          <header className="overflow-hidden rounded-card border border-ink-200 bg-white shadow-card">
            <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:gap-6 sm:p-8">
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-brand-600 text-white shadow-raised">
                <Icon name="bolt" size={30} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    label={SERVICE_TYPE_LABEL[service.serviceType as ServiceType] ?? service.serviceType}
                    tone="brand"
                  />
                  <Link
                    href={`/categories/${service.categorySlug}`}
                    className="text-xs font-medium text-ink-500 transition hover:text-brand-600"
                  >
                    {service.categoryName}
                  </Link>
                  <span aria-hidden className="text-ink-300">·</span>
                  <span className="text-xs text-ink-500">{service.subCategoryName}</span>
                </div>
                <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
                  {service.name}
                </h1>
                {service.description && (
                  <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-600">
                    {service.description}
                  </p>
                )}
              </div>
            </div>
          </header>

          <RatingsPanel average={avg} count={service.rating?.count ?? 0} />

          {service.includedWork && (
            <section
              className="mt-6 rounded-card border border-ink-200 bg-white p-6 shadow-card sm:p-8"
              aria-labelledby="included-heading"
            >
              <h2 id="included-heading" className="text-lg font-bold tracking-tight text-ink-900">
                What the visit covers
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">{service.includedWork}</p>
            </section>
          )}

          <ReviewsSection reviews={reviews} />

          {service.related.length > 0 && (
            <section
              className="mt-6 rounded-card border border-ink-200 bg-white p-6 shadow-card sm:p-8"
              aria-labelledby="related-heading"
            >
              <h2 id="related-heading" className="text-lg font-bold tracking-tight text-ink-900">
                Related services
              </h2>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {service.related.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/services/${r.slug}`}
                      className="group flex items-center justify-between gap-2 rounded-card border border-ink-200 bg-white px-4 py-3 text-sm transition hover:border-brand-300"
                    >
                      <span className="font-medium text-ink-800 group-hover:text-brand-700">
                        {r.name}
                      </span>
                      <Icon
                        name="chevron-right"
                        size={16}
                        className="shrink-0 text-ink-300 group-hover:text-brand-500"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <BookingSidebar
          service={service}
          optionsByCharging={optionsByCharging}
          tel={tel}
          wa={wa}
        />
      </div>
    </div>
  );
}

/**
 * Ratings aggregate APPROVED reviews only. With no reviews we show an explicit
 * empty state rather than a 0-star score, which would read as a real rating.
 */
function RatingsPanel({ average, count }: { average: number; count: number }) {
  if (count === 0) {
    return (
      <div className="mt-6 rounded-card border border-dashed border-ink-300 bg-white px-4 py-4 text-sm text-ink-500">
        No reviews yet. Ratings appear here once customers complete a booking and leave feedback.
      </div>
    );
  }

  return (
    <section className="mt-6" aria-label="Average rating">
      <div className="flex items-center gap-3 rounded-card border border-ink-200 bg-white p-4">
        <span className="text-2xl font-bold tabular-nums text-ink-900">{average.toFixed(1)}</span>
        <div>
          <div className="flex items-center gap-0.5" aria-hidden>
            {[1, 2, 3, 4, 5].map((n) => (
              <Icon
                key={n}
                name={average >= n ? 'star-filled' : 'star'}
                size={16}
                className={average >= n ? 'text-warning' : 'text-ink-300'}
              />
            ))}
          </div>
          <p className="mt-0.5 text-xs text-ink-500">
            Based on {count} {count === 1 ? 'review' : 'reviews'}
          </p>
        </div>
      </div>
    </section>
  );
}

function ReviewsSection({ reviews }: { reviews: Review[] }) {
  return (
    <section className="mt-8" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading" className="text-lg font-bold tracking-tight text-ink-900">
        Customer reviews
      </h2>
      <div className="mt-4">
        {reviews.length === 0 ? (
          <EmptyState
            icon="star"
            title="No published reviews yet"
            description="Reviews are shown after a booking is completed and the feedback is approved."
          />
        ) : (
          <ul className="space-y-3">
            {reviews.map((review) => (
              <li key={review.id} className="rounded-card border border-ink-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  {/* Only the first name is exposed, never contact details. */}
                  <p className="text-sm font-semibold text-ink-800">
                    {review.customer.name.split(' ')[0]}
                  </p>
                  <p className="shrink-0 text-xs text-ink-400">{formatDate(review.createdAt)}</p>
                </div>
                <div
                  className="mt-1.5 flex items-center gap-0.5"
                  aria-label={`${review.rating} out of 5`}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Icon
                      key={n}
                      name={review.rating >= n ? 'star-filled' : 'star'}
                      size={14}
                      className={review.rating >= n ? 'text-warning' : 'text-ink-300'}
                    />
                  ))}
                </div>
                {review.comment && (
                  <p className="mt-2 text-sm leading-relaxed text-ink-600">{review.comment}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

type ChargingMap = Map<
  string,
  {
    charging: string;
    pricePaise: number | null;
    budgetMinPaise: number | null;
    budgetMaxPaise: number | null;
    durationMinMinutes: number | null;
  }
>;

function BookingSidebar({
  service,
  optionsByCharging,
  tel,
  wa,
}: {
  service: ServiceDetail;
  optionsByCharging: ChargingMap;
  tel: string | null;
  wa: string | null;
}) {
  return (
    <aside className="lg:col-span-1">
      <div className="lg:sticky lg:top-24">
        <section className="rounded-card border border-ink-200 bg-white p-5 shadow-card">
          <h2 className="text-base font-bold text-ink-900">Charging options</h2>
          <p className="mt-1 text-xs text-ink-500">
            Prices are published by the provider. Select an option when you book.
          </p>

          <ul className="mt-4 space-y-3">
            {CHARGING_OPTIONS.map((option) => {
              const published = optionsByCharging.get(option);
              const price = published?.pricePaise ?? null;

              return (
                <li key={option} className="rounded-card border border-ink-200 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-ink-800">
                      {CHARGING_LABEL[option]}
                    </span>
                    <span className="text-sm font-bold tabular-nums text-ink-900">
                      {/*
                        Honest fallback: "Unavailable" / "On request" rather
                        than inventing a number for an unpublished price.
                      */}
                      {price != null ? formatINR(price) : published ? 'On request' : 'Unavailable'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-500">
                    {CHARGING_HINT[option]}
                  </p>
                  {option === 'CUSTOMER_BUDGET' && published?.budgetMinPaise != null && (
                    <p className="mt-1 text-xs text-ink-400">
                      Enter a budget between {formatINR(published.budgetMinPaise)} and{' '}
                      {formatINR(published.budgetMaxPaise)}.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <Link
            href={`/book?service=${encodeURIComponent(service.slug)}`}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated"
          >
            <Icon name="bolt" size={16} />
            Book this service
          </Link>

          <div className="mt-3 flex gap-2">
            {tel && (
              <a
                href={tel}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
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
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
              >
                <Icon name="whatsapp" size={14} />
                WhatsApp
              </a>
            )}
          </div>

          {/*
            Availability is deliberately NOT asserted. The system does not know a
            technician's location or current workload, so any "available now"
            claim would be fabricated.
          */}
          <p className="mt-4 flex items-start gap-1.5 text-xs leading-relaxed text-ink-500">
            <Icon name="info" size={14} className="mt-0.5 shrink-0" />
            Technician availability and arrival time are confirmed after a booking is placed.
          </p>
        </section>

        {service.provider && (
          <section className="mt-4 rounded-card border border-ink-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-ink-900">Provider</h2>
            <p className="mt-1 text-sm font-medium text-ink-700">{service.provider.displayName}</p>
            {service.provider.description && (
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                {service.provider.description}
              </p>
            )}
            {service.provider.registeredAddress && (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-500">
                <Icon name="location" size={14} className="mt-0.5 shrink-0" />
                {service.provider.registeredAddress}
              </p>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}