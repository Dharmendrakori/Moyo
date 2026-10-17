import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/States';
import { BookingWizard } from '@/components/customer/BookingWizard';
import { listCategories, getCategoryBySlug, getServiceChargingOptions } from '@/lib/queries';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { formatINR } from '@/lib/format';
import type { WizardCatalog } from '@/components/customer/BookingWizard';

export const metadata: Metadata = {
  title: 'Book a service',
  description:
    'Book a field service on MOYO: choose a category, a service and a charging option, then confirm your booking.',
};

/**
 * Shape returned by `getCategoryBySlug`. Declared locally because the exported
 * `SubCategoryWithServices` type describes a single sub-category, while this
 * query returns the whole category with its children.
 */
type CategoryWithSubCategories = Awaited<ReturnType<typeof getCategoryBySlug>> & object;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * BOOKING WIZARD (steps 1-3)
 *
 * Steps 1 to 3 are rendered on the SERVER from the real catalog queries:
 *   1. Category  - the 20 official categories, read from the database
 *   2. Service   - services within the chosen category
 *   3. Charging  - the three official charging options and what is published
 *
 * The catalog is therefore never duplicated into a client-side constant. The
 * client component takes over at step 4 (details -> confirm -> created), which
 * is where interactivity and form state are actually required.
 *
 * `?service=<slug>` (used by the service page's "Book this service" button)
 * deep-links towards step 3 by resolving the slug server-side.
 */
export default async function BookPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  let categorySlug = first(params.category);
  const serviceSlug = first(params.service);
  const charging = first(params.charging);

  const user = await getCurrentUser();

  // Deep link: a service slug on its own still needs its category.
  if (serviceSlug && !categorySlug) {
    categorySlug = await resolveServiceCategory(serviceSlug);
  }

  const category = categorySlug ? await getCategoryBySlug(categorySlug) : null;
  const services = category ? category.subCategories.flatMap((sub) => sub.services) : [];
  const chosen = serviceSlug ? services.find((s) => s.slug === serviceSlug) : undefined;

  // A stale or forged slug falls back to step 1 rather than erroring out.
  if (category && serviceSlug && !chosen) {
    return (
      <WizardShell currentStep={1}>
        <CategoryStep />
      </WizardShell>
    );
  }

  if (!category) {
    return (
      <WizardShell currentStep={1}>
        <CategoryStep />
      </WizardShell>
    );
  }

  if (!chosen) {
    return (
      <WizardShell currentStep={2} category={category.name}>
        <ServiceStep category={category} />
      </WizardShell>
    );
  }

  // Steps 3-4. Both need the resolved service; the client component owns the
  // interaction from here, so it receives the already-fetched catalog data.
  // Charging options are loaded for THIS service only - a separate, narrow query
  // rather than widening the category browse projection.
  const chargingOptions = await getServiceChargingOptions(chosen.id);

  const catalog: WizardCatalog = {
    categoryName: category.name,
    categorySlug: category.slug,
    service: {
      id: chosen.id,
      name: chosen.name,
      slug: chosen.slug,
      serviceType: chosen.serviceType,
      description: chosen.description,
      includedWork: chosen.includedWork,
    },
    options: chargingOptions,
    defaults: {
      contactName: user?.name ?? '',
      contactPhone: user?.phone ?? '',
    },
  };

  // Only honour a charging option the catalog actually publishes as active.
  const initialCharging =
    charging && chargingOptions.some((o) => o.charging === charging) ? charging : null;

  return (
    <WizardShell currentStep={initialCharging ? 4 : 3} category={category.name}>
      <BookingWizard catalog={catalog} initialCharging={initialCharging} signedIn={Boolean(user)} />
    </WizardShell>
  );
}

function first(v: string | string[] | undefined): string | undefined {
  const value = Array.isArray(v) ? v[0] : v;
  return value && value.length > 0 && value.length <= 120 ? value : undefined;
}

/** Resolves a service slug to its category slug, for `?service=` deep links. */
async function resolveServiceCategory(serviceSlug: string): Promise<string | undefined> {
  const row = await prisma.service.findFirst({
    where: { slug: serviceSlug, isActive: true },
    select: { subCategory: { select: { category: { select: { slug: true } } } } },
  });
  return row?.subCategory.category.slug;
}

/** Shared page chrome: heading, step indicator and sign-in prompt. */
function WizardShell({
  currentStep,
  category,
  children,
}: {
  currentStep: number;
  category?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Book a service</h1>
        <p className="mt-1 text-sm text-ink-500">
          {category ? `${category} · step ${currentStep} of 6` : 'Choose a category to begin.'}
        </p>
      </header>

      <ol className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs" aria-label="Booking steps">
        {['Category', 'Service', 'Charging', 'Details', 'Confirm', 'Booked'].map((label, i) => {
          const n = i + 1;
          const done = n < currentStep;
          const active = n === currentStep;
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                aria-current={active ? 'step' : undefined}
                className={
                  active
                    ? 'rounded-full bg-brand-600 px-2.5 py-1 font-semibold text-white'
                    : done
                      ? 'rounded-full bg-brand-50 px-2.5 py-1 font-semibold text-brand-700'
                      : 'rounded-full bg-ink-100 px-2.5 py-1 font-medium text-ink-500'
                }
              >
                {done ? <span aria-hidden>✓ </span> : null}
                {n}. {label}
              </span>
              {n < 6 && <Icon name="chevron-right" size={12} className="text-ink-300" />}
            </li>
          );
        })}
      </ol>

      <div className="mt-6">{children}</div>
    </div>
  );
}

/** Step 1 - the 20 official categories, straight from the database. */
async function CategoryStep() {
  const categories = await listCategories();

  if (categories.length === 0) {
    return (
      <div className="rounded-card border border-ink-200 bg-white">
        <EmptyState
          icon="grid"
          title="No service categories are published yet"
          description="The service catalog is not available right now. Please check back shortly."
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {categories.map((c) => (
        <Link
          key={c.id}
          href={`/book?category=${encodeURIComponent(c.slug)}`}
          className="group flex items-start justify-between gap-3 rounded-xl border border-ink-200 bg-white p-4 shadow-card transition-all duration-300 hover:border-brand-300 hover:shadow-elevated hover:-translate-y-0.5"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              Category {c.position}
            </p>
            <h2 className="mt-0.5 text-sm font-semibold leading-snug text-ink-900 group-hover:text-brand-700">
              {c.name}
            </h2>
            <p className="mt-1.5 text-xs text-ink-500">
              {c.serviceCount} {c.serviceCount === 1 ? 'service' : 'services'}
            </p>
          </div>
          <Icon
            name="chevron-right"
            size={18}
            className="mt-1 shrink-0 text-ink-300 transition group-hover:text-brand-500"
          />
        </Link>
      ))}
    </div>
  );
}

/** Step 2 - services within the chosen category. */
function ServiceStep({ category }: { category: NonNullable<CategoryWithSubCategories> }) {
  const count = category.subCategories.reduce((sum, sub) => sum + sub.services.length, 0);

  if (count === 0) {
    return (
      <div className="rounded-card border border-ink-200 bg-white">
        <EmptyState
          icon="list"
          title="No services are published in this category yet"
          description="Please choose another category."
          action={
            <Link
              href="/book"
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated"
            >
              Back to categories
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {category.subCategories.map((sub) =>
        sub.services.length === 0 ? null : (
          <section key={sub.id} aria-labelledby={`sub-${sub.slug}`}>
            <h2 id={`sub-${sub.slug}`} className="text-sm font-bold tracking-tight text-ink-900">
              {sub.name}
            </h2>
            <ul className="mt-3 space-y-2">
              {sub.services.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/book?category=${encodeURIComponent(category.slug)}&service=${encodeURIComponent(s.slug)}`}
                    className="group flex items-start justify-between gap-3 rounded-xl border border-ink-200 bg-white p-4 shadow-card transition-all duration-300 hover:border-brand-300 hover:shadow-elevated hover:-translate-y-0.5"
                  >
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-ink-900 group-hover:text-brand-700">
                        {s.name}
                      </h3>
                      {s.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-ink-500">{s.description}</p>
                      )}
                      {/* Honest pricing state: a number only when published. */}
                      <p className="mt-2 text-xs font-medium text-ink-600">
                        {s.priceFromPaise != null ? (
                          <>
                            From <span className="font-bold">{formatINR(s.priceFromPaise)}</span>
                          </>
                        ) : (
                          <span className="text-ink-400">Shown after booking</span>
                        )}
                      </p>
                    </div>
                    <Icon
                      name="chevron-right"
                      size={18}
                      className="mt-1 shrink-0 text-ink-300 transition group-hover:text-brand-500"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
