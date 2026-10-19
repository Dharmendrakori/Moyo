import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { CategoryMosaicTile } from '@/components/customer/Showcase';
import { listCategories } from '@/lib/queries';

export const metadata: Metadata = {
  title: 'Service categories',
  description:
    'Browse all 20 official Seric Tech Solutions service categories, from home and household services to material ordering.',
};

/**
 * CATEGORY INDEX
 *
 * Renders all 20 official categories from the database. This is the entry point
 * of the booking funnel: category -> service -> charging option -> booking.
 */
export default async function CategoriesPage() {
  const categories = await listCategories();
  const totalServices = categories.reduce((sum, c) => sum + c.serviceCount, 0);

  return (
    <div className="bg-cream-50">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <Breadcrumbs trail={[{ label: 'Home', href: '/' }, { label: 'Categories' }]} />

        <header className="relative mt-6 overflow-hidden rounded-3xl bg-night-950 p-8 text-white shadow-overlay sm:p-12">
          <div className="absolute inset-0 texture-dots opacity-60" aria-hidden />
          <div className="relative max-w-2xl">
            <p className="eyebrow text-gold-400">
              <span className="h-px w-8 bg-gold-400" aria-hidden />
              The catalog
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-5xl">
              Service categories
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">
              {categories.length} categories covering {totalServices} services. Choose a
              category to see its services and book.
            </p>
            <Link
              href="/book"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-ink-900 transition hover:bg-gold-400 hover:text-night-950"
            >
              <Icon name="bolt" size={16} /> Book a service
            </Link>
          </div>
        </header>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((category, i) => (
            <CategoryMosaicTile
              key={category.id}
              category={category}
              size={i === 0 ? 'lead' : i === 5 ? 'tall' : 'standard'}
            />
          ))}
        </div>
      </div>
    </div>
  );
}