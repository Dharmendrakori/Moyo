import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { CategoryCard, ServiceCard } from '@/components/customer/Cards';
import { getCategoryBySlug, listCategories } from '@/lib/queries';
import { SERVICE_TYPE_LABEL, type ServiceType } from '@/lib/domain';
import { formatINR } from '@/lib/format';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) return { title: 'Category not found' };
  return { title: category.name, description: category.description ?? undefined };
}

/**
 * CATEGORY DETAIL
 *
 * Data-driven: every category renders from the same template, backed by the
 * database. No per-category HTML exists anywhere in the codebase.
 */
export default async function CategoryPage({ params }: Params) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const allCategories = await listCategories();
  const totalServices = category.subCategories.reduce((n, s) => n + s.services.length, 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="mb-5">
        <ol className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
          <li>
            <Link href="/" className="transition hover:text-brand-600">
              Home
            </Link>
          </li>
          <li aria-hidden>
            <Icon name="chevron-right" size={12} className="text-ink-300" />
          </li>
          <li>
            <Link href="/categories" className="transition hover:text-brand-600">
              Categories
            </Link>
          </li>
          <li aria-hidden>
            <Icon name="chevron-right" size={12} className="text-ink-300" />
          </li>
          <li className="font-medium text-ink-700" aria-current="page">
            {category.name}
          </li>
        </ol>
      </nav>

      <header className="rounded-card border border-ink-200 bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
          Category {category.position}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900">{category.name}</h1>
        {category.description && (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-600">
            {category.description}
          </p>
        )}
        <p className="mt-3 text-sm text-ink-500">
          {category.subCategories.length} sub-categories &middot; {totalServices} services
        </p>
      </header>

      {/* Sub-categories with their services */}
      <div className="mt-8 space-y-8">
        {category.subCategories.map((sub) => (
          <section key={sub.id} aria-labelledby={`sub-${sub.id}`}>
            <div className="flex items-baseline justify-between gap-3">
              <h2
                id={`sub-${sub.id}`}
                className="text-lg font-bold tracking-tight text-ink-900"
              >
                {sub.name}
              </h2>
              <span className="text-xs text-ink-400">
                {sub.services.length}{' '}
                {sub.services.length === 1 ? 'service' : 'services'}
              </span>
            </div>

            {sub.services.length === 0 ? (
              <p className="mt-3 rounded-card border border-dashed border-ink-300 bg-white px-4 py-6 text-center text-sm text-ink-500">
                No services are published in this sub-category yet.
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sub.services.map((service) => (
                  <ServiceCard
                    key={service.id}
                    service={{
                      id: service.id,
                      name: service.name,
                      slug: service.slug,
                      serviceType: service.serviceType,
                      description: service.description,
                      categoryName: category.name,
                      categorySlug: category.slug,
                      priceFromPaise: service.priceFromPaise,
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      {/* Other categories */}
      <section className="mt-12 border-t border-ink-200 pt-8">
        <h2 className="text-lg font-bold tracking-tight text-ink-900">Other categories</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {allCategories
            .filter((c) => c.slug !== category.slug)
            .slice(0, 6)
            .map((c) => (
              <CategoryCard key={c.id} category={c} />
            ))}
        </div>
      </section>
    </div>
  );
}

/** Exported for the price-availability note reused in service detail. */
export function priceNote(paise: number | null): string {
  return paise != null ? formatINR(paise) : 'Pricing shown after booking';
}

export const SERVICE_LABELS = SERVICE_TYPE_LABEL;
export type { ServiceType };