import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/States';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { CategoryCard, ServiceCard } from '@/components/customer/Cards';
import {
  listCategories,
  searchCatalog,
  searchServices,
  SEARCH_PAGE_SIZE,
} from '@/lib/queries';

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search MOYO services by name, or browse all service categories.',
  // Utility page; not useful as a search-engine target.
  robots: { index: false, follow: true },
};

/**
 * CUSTOMER CATALOG SEARCH
 *
 * A plain server-rendered GET form backed by the REAL catalogue through
 * `searchServices` / `searchCatalog` in `src/lib/queries.ts` - there is no
 * parallel client-side index. Every result URL is shareable and back-button
 * friendly because the entire view is expressed by `?q=` and `?page=`.
 * Only ACTIVE services and categories are ever shown, and pricing uses the
 * same honest "lowest published price or none" rule as the rest of the
 * catalogue.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** Control characters stripped, hard length cap (defence in depth). */
function sanitizeTerm(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 80);
}

const MAX_PAGE = 100;

function buildHref(q: string, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/search?${qs}` : '/search';
}

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = sanitizeTerm(first(params.q));
  const pageRaw = Number.parseInt(first(params.page), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 1 ? Math.min(pageRaw, MAX_PAGE) : 1;

  const [result, matches] = await Promise.all([
    searchServices(q, page),
    q ? searchCatalog(q) : Promise.resolve({ categories: [], services: [] }),
  ]);
  // The no-query state doubles as discovery: browse every category.
  const browseCategories = q ? [] : await listCategories();

  const from = result.total === 0 ? 0 : (page - 1) * SEARCH_PAGE_SIZE + 1;
  const to = from + result.services.length - 1;
  const hasPrev = page > 1;
  const hasNext = result.hasMore;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Breadcrumbs trail={[{ label: 'Home', href: '/' }, { label: 'Search' }]} />

      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">Search MOYO</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-500">
          Find a service by name, or search a category like plumbing, solar or cleaning.
        </p>
      </header>

      <form action="/search" method="get" role="search" className="mt-6 max-w-xl">
        <label htmlFor="search-q" className="sr-only">
          Search services
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              id="search-q"
              type="search"
              name="q"
              defaultValue={q}
              placeholder="e.g. AC repair, plumbing, solar…"
              maxLength={80}
              autoComplete="off"
              className="w-full rounded-xl border border-ink-300 bg-white py-2.5 pl-9 pr-4 text-sm text-ink-900 transition placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            />
          </div>
          <button
            type="submit"
            className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated"
          >
            Search
          </button>
        </div>
      </form>

      {!q ? (
        <section aria-labelledby="browse-heading" className="mt-10">
          <h2 id="browse-heading" className="text-lg font-bold tracking-tight text-ink-900">
            Browse categories
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            {browseCategories.length} official categories. Choose one to see its services.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {browseCategories.map((category) => (
              <CategoryCard key={category.id} category={category} />
            ))}
          </div>
        </section>
      ) : (
        <>
          <p className="mt-8 text-sm text-ink-600" role="status">
            {result.total === 0 ? (
              <>
                No services match <span className="font-semibold text-ink-900">“{q}”</span>.
              </>
            ) : (
              <>
                <span className="font-semibold text-ink-900">{result.total}</span>{' '}
                {result.total === 1 ? 'service matches' : 'services match'}{' '}
                <span className="font-semibold text-ink-900">“{q}”</span>
                {result.total > SEARCH_PAGE_SIZE && (
                  <>
                    {' '}
                    — showing {from}–{to}
                  </>
                )}
                .
              </>
            )}
          </p>

          {matches.categories.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-ink-400">Matching categories:</span>
              {matches.categories.map((c) => (
                <Link
                  key={c.id}
                  href={`/categories/${c.slug}`}
                  className="rounded-xl bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-100"
                >
                  {c.name}
                </Link>
              ))}
            </div>
          )}

          {result.services.length === 0 ? (
            <div className="mt-6 rounded-card border border-ink-200 bg-white">
              <EmptyState
                icon="search"
                title="No results"
                description="Check the spelling, try a shorter term, or browse all categories instead."
                action={
                  <Link
                    href="/categories"
                    className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated"
                  >
                    Browse categories
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {result.services.map((service) => (
                <ServiceCard key={service.id} service={service} />
              ))}
            </div>
          )}

          {(hasPrev || hasNext) && (
            <nav
              aria-label="Search result pages"
              className="mt-8 flex items-center justify-between gap-3"
            >
              {hasPrev ? (
                <Link
                  href={buildHref(q, page - 1)}
                  className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 transition hover:bg-ink-50"
                >
                  <Icon name="chevron-left" size={16} />
                  Previous
                </Link>
              ) : (
                <span aria-hidden />
              )}
              {hasNext ? (
                <Link
                  href={buildHref(q, page + 1)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition-all duration-300 hover:bg-brand-700 hover:shadow-elevated"
                >
                  Next
                  <Icon name="chevron-right" size={16} />
                </Link>
              ) : (
                <span aria-hidden />
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}

