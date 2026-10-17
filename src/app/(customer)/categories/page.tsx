import type { Metadata } from 'next';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { CategoryCard } from '@/components/customer/Cards';
import { listCategories } from '@/lib/queries';

export const metadata: Metadata = {
  title: 'Service categories',
  description:
    'Browse all 20 official MOYO service categories, from home and household services to material ordering.',
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
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Breadcrumbs trail={[{ label: 'Home', href: '/' }, { label: 'Categories' }]} />

      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
          Service categories
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-500">
          {categories.length} categories covering {totalServices} services. Choose a category to see
          its services and book.
        </p>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => (
          <CategoryCard key={category.id} category={category} />
        ))}
      </div>
    </div>
  );
}