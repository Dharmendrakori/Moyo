/**
 * SERIC TECH SOLUTIONS PHASE 2 — SHOWCASE COMPONENTS (part 1)
 *
 * Art-directed presentation over live catalogue data. No business logic:
 * every tile receives real rows and links to real routes. Category tiles show
 * a mapped photograph (see src/lib/category-images) layered over the existing
 * CSS/SVG artwork fallback. No new libraries.
 */
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/format';
import { Icon } from '@/components/ui/Icon';
import { iconForCategory } from '@/components/customer/Cards';
import type { CategoryCard as CategoryCardData } from '@/lib/queries';
import { categoryImageFor } from '@/lib/category-images';

const ART_FAMILIES = ['art-a', 'art-b', 'art-c', 'art-d', 'art-e', 'art-f'] as const;

export function artFor(position: number): string {
  return ART_FAMILIES[(Math.max(1, position) - 1) % ART_FAMILIES.length] as string;
}

/**
 * Sizes hint for a tile-filling category photo. Keeps the browser's paint of
 * the right-sized source stable across viewports without layout shift.
 */
export function tileSizes(size: string): string {
  return size === 'lead'
    ? '(max-width: 768px) 100vw, 50vw'
    : '(max-width: 640px) 100vw, 25vw';
}

/**
 * Editorial mosaic tile for one category. `size` drives homepage rhythm:
 * lead tiles span large, the rest fill the mosaic. Counts/links are exact.
 */
export function CategoryMosaicTile({
  category,
  size = 'standard',
}: {
  category: CategoryCardData;
  size?: 'lead' | 'tall' | 'standard';
}) {
  const icon = iconForCategory(category.iconKey, category.position);
  const art = artFor(category.position);
  const imageSrc = categoryImageFor(category.slug);
  const hasImage = imageSrc != null;

  return (
    <Link
      href={`/categories/${category.slug}`}
      className={cn(
        'group relative flex min-h-[220px] flex-col justify-end overflow-hidden rounded-3xl text-white shadow-raised transition-all duration-500 hover:-translate-y-1.5 hover:shadow-overlay focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
        size === 'lead' && 'sm:col-span-2 sm:min-h-[300px]',
        size === 'tall' && 'sm:row-span-2 sm:min-h-[420px]',
      )}
    >
      {/* Art layer: a real photo when one is mapped, otherwise the SVG ghost
          artwork. Decorative either way - the category name below is the
          accessible text, so the photo uses an empty alt.

          The photo container deliberately does NOT carry `.mosaic-art`: that
          rule sets `position: relative` (unlayered custom CSS beats Tailwind's
          layered `absolute` utility in v4), which would pull the span back into
          normal flow and collapse its height to 0 under a `fill` <Image>. With
          only Tailwind utilities here (`absolute inset-0`), the span fills the
          positioned Link tile unconditionally, so the image always has a
          definite, nonzero height no matter how the stylesheets are cached. */}
      <span
        className={cn(
          'overflow-hidden',
          hasImage
            ? 'mosaic-photo absolute inset-0 isolate'
            : cn('mosaic-art absolute inset-0', art),
        )}
        aria-hidden
      >
        {hasImage ? (
          <Image
            src={imageSrc}
            alt=""
            fill
            sizes={tileSizes(size)}
            className="object-cover"
            loading={size === 'lead' ? 'eager' : 'lazy'}
            decoding="async"
          />
        ) : (
          <>
            <span className="art-zoom absolute inset-0 texture-dots" aria-hidden />
            <Icon name={icon} size={150} className="ghost" />
          </>
        )}
      </span>
      <span
        className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent"
        aria-hidden
      />
      <span className="absolute left-5 top-5 inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white ring-1 ring-inset ring-white/25 backdrop-blur">
        <Icon name={icon} size={13} />
        {String(category.position).padStart(2, '0')}
      </span>
      <span className="relative p-5 sm:p-6">
        <span className="block font-display text-xl font-semibold leading-tight sm:text-2xl">
          {category.name}
        </span>
        {size !== 'standard' && category.description && (
          <span className="mt-2 line-clamp-2 block max-w-md text-sm leading-relaxed text-white/80">
            {category.description}
          </span>
        )}
        <span className="mt-3 flex items-center gap-3 text-xs font-semibold">
          <span className="rounded-full bg-white px-2.5 py-1 text-ink-900">
            {category.serviceCount} {category.serviceCount === 1 ? 'service' : 'services'}
          </span>
          <span className="inline-flex items-center gap-1 text-white/90 transition-all duration-300 group-hover:gap-2 group-hover:text-white">
            Explore <Icon name="chevron-right" size={14} />
          </span>
        </span>
      </span>
    </Link>
  );
}

/** Scrolling strip of live category names linking to real category pages. */
export function CategoryMarquee({ categories }: { categories: CategoryCardData[] }) {
  const items = [...categories, ...categories];
  return (
    <div
      className="relative overflow-hidden border-y border-white/10 bg-night-950 py-4"
      aria-label="Service category ticker"
    >
      <div className="marquee-track flex w-max items-center gap-3 pr-3">
        {items.map((c, i) => (
          <Link
            key={`${c.id}-${i}`}
            href={`/categories/${c.slug}`}
            aria-hidden={i >= categories.length}
            tabIndex={i >= categories.length ? -1 : undefined}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-white/85 transition hover:border-gold-400/60 hover:text-white"
          >
            <Icon name={iconForCategory(c.iconKey, c.position)} size={14} className="text-gold-400" />
            {c.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
