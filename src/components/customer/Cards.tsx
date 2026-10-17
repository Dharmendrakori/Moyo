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
      className={cn(
        'group flex flex-col items-start gap-4 rounded-xl border border-ink-200 bg-white p-5 transition-all duration-300',
        'hover:border-brand-300 hover:shadow-elevated hover:-translate-y-1'
      )}
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 transition-all duration-300 group-hover:bg-brand-600 group-hover:text-white">
        <Icon name={icon} size={22} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">
          Category {category.position}
        </p>
        <h3 className="mt-0.5 text-sm font-semibold leading-snug text-ink-900 group-hover:text-brand-700">
          {category.name}
        </h3>
        {category.description && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-500">
            {category.description}
          </p>
        )}
        <p className="mt-3 text-xs font-medium text-ink-400">
          {category.serviceCount} {category.serviceCount === 1 ? 'service' : 'services'}
        </p>
      </div>

      <Icon
        name="chevron-right"
        size={18}
        className="mt-auto shrink-0 text-ink-300 transition-all duration-300 group-hover:text-brand-500 group-hover:translate-x-1"
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
      className={cn(
        'group flex flex-col rounded-xl border border-ink-200 bg-white p-5 transition-all duration-300',
        'hover:border-brand-300 hover:shadow-elevated hover:-translate-y-1'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-xl bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700">
          <Icon name="bolt" size={12} className="shrink-0" />
          {SERVICE_TYPE_LABEL[service.serviceType as ServiceType] ?? service.serviceType}
        </span>
        <span className="truncate text-[11px] font-medium text-ink-400">{service.categoryName}</span>
      </div>

      <h3 className="mt-3 text-sm font-semibold leading-snug text-ink-900 group-hover:text-brand-700">
        {service.name}
      </h3>

      {service.description && (
        <p className="mt-2 line-clamp-2 flex-1 text-sm leading-relaxed text-ink-500">
          {service.description}
        </p>
      )}

      <div className="mt-5 border-t border-ink-100 pt-4">
        <p className="text-[10px] font-medium uppercase tracking-wider text-ink-400">
          {service.priceFromPaise != null ? 'From' : 'Pricing'}
        </p>
        <p
          className={cn(
            'mt-1 text-sm font-bold tabular-nums',
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