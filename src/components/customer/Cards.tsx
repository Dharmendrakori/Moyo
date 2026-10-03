import Link from 'next/link';
import { cn, formatINR } from '@/lib/format';
import { Icon, type IconName } from '@/components/ui/Icon';
import type { CategoryCard as CategoryCardData } from '@/lib/queries';
import { SERVICE_TYPE_LABEL, type ServiceType } from '@/lib/domain';

/**
 * CATALOG CARDS
 *
 * Reusable across the homepage, category pages and search results so markup is
 * never duplicated.
 */

const ICONS: IconName[] = [
  'home',
  'bolt',
  'office',
  'hotel',
  'education',
  'event',
  'industry',
  'solar',
  'agriculture',
  'compute',
  'construction-electrical',
  'civil',
  'plumbing',
  'carpentry',
  'painting',
  'cleaning',
  'interior',
  'contract',
  'people',
  'materials',
];

/**
 * Resolves a category icon key to a known icon.
 * Unknown or missing keys fall back to a neutral index-derived icon rather than
 * rendering a broken glyph.
 */
export function iconForCategory(iconKey: string | null, position: number): IconName {
  const index = ICONS.indexOf((iconKey ?? '') as IconName);
  if (index >= 0) return ICONS[index] as IconName;
  return ICONS[(Math.max(1, position) - 1) % ICONS.length] as IconName;
}

export function CategoryCard({ category }: { category: CategoryCardData }) {
  const icon = iconForCategory(category.iconKey, category.position);

  return (
    <Link
      href={`/categories/${category.slug}`}
      className="group flex items-start gap-4 rounded-card border border-ink-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-raised"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">
        <Icon name={icon} size={20} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">
          Category {category.position}
        </p>
        <h3 className="mt-0.5 text-sm font-semibold leading-snug text-ink-900 group-hover:text-brand-700">
          {category.name}
        </h3>
        {category.description && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-500">
            {category.description}
          </p>
        )}
        <p className="mt-2 text-xs font-medium text-ink-400">
          {category.serviceCount} {category.serviceCount === 1 ? 'service' : 'services'}
        </p>
      </div>

      <Icon
        name="chevron-right"
        size={18}
        className="mt-1 shrink-0 text-ink-300 transition group-hover:text-brand-500"
      />
    </Link>
  );
}

export type ServiceCardData = {
  id: string;
  name: string;
  slug: string;
  serviceType: string;
  description: string | null;
  categoryName: string;
  categorySlug: string;
  priceFromPaise: number | null;
};

export function ServiceCard({ service }: { service: ServiceCardData }) {
  return (
    <Link
      href={`/services/${service.slug}`}
      className="group flex flex-col rounded-card border border-ink-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-raised"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-md bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-600">
          {SERVICE_TYPE_LABEL[service.serviceType as ServiceType] ?? service.serviceType}
        </span>
        <span className="truncate text-[11px] font-medium text-ink-400">{service.categoryName}</span>
      </div>

      <h3 className="mt-3 text-sm font-semibold leading-snug text-ink-900 group-hover:text-brand-700">
        {service.name}
      </h3>

      {service.description && (
        <p className="mt-2 line-clamp-2 flex-1 text-xs leading-relaxed text-ink-500">
          {service.description}
        </p>
      )}

      <div className="mt-4 border-t border-ink-100 pt-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">
          {service.priceFromPaise != null ? 'From' : 'Pricing'}
        </p>
        <p
          className={cn(
            'mt-0.5 text-sm font-bold',
            service.priceFromPaise != null ? 'text-ink-900' : 'text-ink-400',
          )}
        >
          {/*
            Honest fallback: when a provider has not published a price we say so
            instead of showing an invented number.
          */}
          {service.priceFromPaise != null
            ? formatINR(service.priceFromPaise)
            : 'Shown after booking'}
        </p>
      </div>
    </Link>
  );
}