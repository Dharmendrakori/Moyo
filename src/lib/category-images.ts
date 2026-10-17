/**
 * CATEGORY IMAGE MAP
 *
 * Centralized mapping from canonical category slug (as returned by
 * `listCategories` in `src/lib/queries`) to the public category-card image.
 *
 * The source images live in `moyo-category-images/` and were copied into
 * `public/images/categories/` (originals preserved). Paths are stable public
 * URLs, never developer-specific absolute paths.
 *
 * All 20 official categories currently have a photograph. A category without an
 * entry still intentionally keeps the existing SVG artwork fallback - no
 * unrelated image is assigned silently. Any such categories are listed in
 * `UNMAPPED_CATEGORY_SLUGS` and documented in the project change report.
 *
 * Slugs were verified against the live database (`prisma.category`) and are
 * keyed by slug, not by image filename, because the image pack names do not
 * always match the canonical slugs exactly (e.g. "Home & Household Services"
 * is `home-and-household-services` but ships as `home-household-services.jpg`).
 */

export const CATEGORY_IMAGES: Record<string, string> = {
  'home-and-household-services': '/images/categories/home-household-services.jpg',
  'hospital-and-medical-equipment-services': '/images/categories/hospital-medical-equipment.jpg',
  'hotel-and-restaurant-services': '/images/categories/hotel-restaurant-services.jpg',
  'college-and-school-services': '/images/categories/college-school-services.jpg',
  'event-management-and-support': '/images/categories/event-management-support.jpg',
  'agricultural-electrical-services': '/images/categories/gardening-landscaping.jpg',
  'computing-and-electronics-item-services': '/images/categories/it-technical-support.jpg',
  'plumbing-and-water-system-services': '/images/categories/plumbing-services.jpg',
  'cleaning-and-sanitization-services': '/images/categories/cleaning-housekeeping.jpg',
  'home-renovation-and-interior-design': '/images/categories/interior-design.jpg',
  'office-and-shop-services': '/images/categories/office-and-shop-services.jpg',
  'industrial-and-company-services': '/images/categories/industrial-and-company-services.jpg',
  'renewable-energy-and-solar-projects': '/images/categories/renewable-energy-and-solar-projects.jpg',
  'construction-and-building-electrical-services': '/images/categories/construction-and-building-electrical-services.jpg',
  'civil-and-building-construction-services': '/images/categories/civil-and-building-construction-services.jpg',
  'carpentry-and-woodwork-services': '/images/categories/carpentry-and-woodwork-services.jpg',
  'painting-and-home-improvement-services': '/images/categories/painting-and-home-improvement-services.jpg',
  'contract-and-maintenance-plans': '/images/categories/contract-and-maintenance-plans.jpg',
  'man-power-requirement': '/images/categories/man-power-requirement.jpg',
  'new-material-ordering': '/images/categories/new-material-ordering.jpg',
} as const;

/**
 * Slugs of active categories that still have no appropriate image, and so render
 * the existing SVG artwork fallback (see Showcase.tsx). All 20 official
 * categories are currently mapped, so this list is empty; it is retained and
 * exported as the single place a future unmapped category would be recorded.
 */
export const UNMAPPED_CATEGORY_SLUGS: string[] = [];

export type CategoryImageSlug = keyof typeof CATEGORY_IMAGES;

/**
 * Resolves a category slug to its public card-image path, or null when no
 * appropriate image exists. Callers fall back to the existing SVG artwork.
 *
 * The tile photo is decorative: the category name is rendered as adjacent
 * visible text, so callers should pass `alt=""` to screen readers.
 */
export function categoryImageFor(slug: string): string | null {
  return CATEGORY_IMAGES[slug as CategoryImageSlug] ?? null;
}

/** Returns true when the category has a mapped card image. */
export function hasCategoryImage(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(CATEGORY_IMAGES, slug);
}
