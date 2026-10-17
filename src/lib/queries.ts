import 'server-only';
import { prisma } from './prisma';

/**
 * READ MODELS
 *
 * Server-only data access for the customer-facing and admin surfaces.
 *
 * These functions return ONLY the fields the view needs. That is deliberate
 * minimization: a narrow projection cannot leak a password hash, a session
 * token or an internal counter even if a component is rendered in the wrong
 * context.
 */

// --- Public catalog ---------------------------------------------------------

export type CategoryCard = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  iconKey: string | null;
  position: number;
  serviceCount: number;
};

/** All active categories with a live count of their active services. */
export async function listCategories(): Promise<CategoryCard[]> {
  const rows = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      iconKey: true,
      position: true,
      subCategories: {
        select: { services: { where: { isActive: true }, select: { id: true } } },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    iconKey: r.iconKey,
    position: r.position,
    serviceCount: r.subCategories.reduce((sum, sub) => sum + sub.services.length, 0),
  }));
}

export type SubCategoryWithServices = {
  id: string;
  name: string;
  slug: string;
  services: Array<{
    id: string;
    name: string;
    slug: string;
    serviceType: string;
    description: string | null;
    includedWork: string | null;
    /** Lowest published price across active options, or null when unpublished. */
    priceFromPaise: number | null;
    availableCharging: string[];
  }>;
};

/**
 * One category with its sub-categories and services.
 * `priceFromPaise` is the lowest published price across active options, or null
 * when the provider has not published pricing yet.
 */
export async function getCategoryBySlug(slug: string) {
  const cat = await prisma.category.findFirst({
    where: { slug, isActive: true },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      iconKey: true,
      position: true,
      subCategories: {
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          services: {
            where: { isActive: true },
            orderBy: { name: 'asc' },
            select: {
              id: true,
              name: true,
              slug: true,
              serviceType: true,
              description: true,
              includedWork: true,
              options: {
                where: { isActive: true },
                select: { charging: true, pricePaise: true },
              },
            },
          },
        },
      },
    },
  });

  if (!cat) return null;

  const subCategories: SubCategoryWithServices[] = cat.subCategories.map((sub) => ({
    id: sub.id,
    name: sub.name,
    slug: sub.slug,
    services: sub.services.map((s) => {
      const priced = s.options
        .map((o) => o.pricePaise)
        .filter((p): p is number => p != null && p > 0);
      return {
        id: s.id,
        name: s.name,
        slug: s.slug,
        serviceType: s.serviceType,
        description: s.description,
        includedWork: s.includedWork,
        priceFromPaise: priced.length > 0 ? Math.min(...priced) : null,
        availableCharging: s.options.map((o) => o.charging),
      };
    }),
  }));

  return {
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    description: cat.description,
    iconKey: cat.iconKey,
    position: cat.position,
    subCategories,
  };
}

/**
 * Charging options published for one service, for the booking wizard.
 *
 * Kept separate from `getCategoryBySlug` on purpose: that function projects a
 * narrow list shape (a low "from" price) for browsing, while the wizard needs
 * the actual per-option rows. Only fields the wizard displays are selected, and
 * only ACTIVE options are returned - an inactive option cannot be chosen, so
 * surfacing it would be misleading.
 */
export async function getServiceChargingOptions(serviceId: string) {
  return prisma.serviceOption.findMany({
    where: { serviceId, isActive: true },
    orderBy: { charging: 'asc' },
    select: {
      charging: true,
      pricePaise: true,
      budgetMinPaise: true,
      budgetMaxPaise: true,
      durationMinMinutes: true,
    },
  });
}

export type ServiceDetail = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  includedWork: string | null;
  serviceType: string;
  categoryName: string;
  categorySlug: string;
  subCategoryName: string;
  options: Array<{
    charging: string;
    pricePaise: number | null;
    budgetMinPaise: number | null;
    budgetMaxPaise: number | null;
    durationMinMinutes: number | null;
  }>;
  provider: {
    displayName: string;
    description: string | null;
    contactPhone: string | null;
    whatsappNumber: string | null;
    registeredAddress: string | null;
    contactEmail: string | null;
    serviceAreaCities: string | null;
  } | null;
  /** Aggregated from APPROVED reviews only. Zero reviews => null, never 0 stars. */
  rating: { average: number | null; count: number } | null;
  related: Array<{ id: string; name: string; slug: string }>;
};

export async function getServiceBySlug(slug: string): Promise<ServiceDetail | null> {
  const service = await prisma.service.findFirst({
    where: { slug, isActive: true },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      includedWork: true,
      serviceType: true,
      subCategory: {
        select: {
          id: true,
          name: true,
          category: { select: { name: true, slug: true } },
        },
      },
      options: {
        where: { isActive: true },
        select: {
          charging: true,
          pricePaise: true,
          budgetMinPaise: true,
          budgetMaxPaise: true,
          durationMinMinutes: true,
        },
      },
      providers: {
        where: { provider: { isActive: true } },
        take: 1,
        select: {
          provider: {
            select: {
              displayName: true,
              description: true,
              contactPhone: true,
              whatsappNumber: true,
              registeredAddress: true,
              contactEmail: true,
              serviceAreaCities: true,
            },
          },
        },
      },
      reviews: { where: { isApproved: true }, select: { rating: true } },
    },
  });

  if (!service) return null;

  const ratings = service.reviews.map((r) => r.rating);
  const rating =
    ratings.length > 0
      ? {
          average: Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)),
          count: ratings.length,
        }
      : null;

  // Related services from the same sub-category, excluding this one.
  const relatedRows = await prisma.service.findMany({
    where: { subCategoryId: service.subCategory.id, isActive: true, id: { not: service.id } },
    orderBy: { name: 'asc' },
    take: 4,
    select: { id: true, name: true, slug: true },
  });

  return {
    id: service.id,
    name: service.name,
    slug: service.slug,
    description: service.description,
    includedWork: service.includedWork,
    serviceType: service.serviceType,
    categoryName: service.subCategory.category.name,
    categorySlug: service.subCategory.category.slug,
    subCategoryName: service.subCategory.name,
    options: service.options,
    provider: service.providers[0]?.provider ?? null,
    rating,
    related: relatedRows,
  };
}

/** Approved reviews for a service, newest first. */
export async function getServiceReviews(serviceId: string) {
  return prisma.review.findMany({
    where: { serviceId, isApproved: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      rating: true,
      comment: true,
      createdAt: true,
      // First name only - never expose a reviewer's phone, email or address.
      customer: { select: { name: true } },
    },
  });
}

/** Text search across active categories and services. */
export async function searchCatalog(term: string) {
  const q = term.trim();
  if (!q) return { categories: [], services: [] };

  const [categories, services] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true, name: { contains: q } },
      orderBy: { position: 'asc' },
      take: 4,
      select: { id: true, name: true, slug: true, position: true },
    }),
    prisma.service.findMany({
      where: { isActive: true, name: { contains: q } },
      take: 8,
      select: {
        id: true,
        name: true,
        slug: true,
        subCategory: { select: { category: { select: { name: true, slug: true } } } },
      },
    }),
  ]);

  return {
    categories,
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      categoryName: s.subCategory.category.name,
      categorySlug: s.subCategory.category.slug,
    })),
  };
}

// --- Customer catalog search (paged) ----------------------------------------

/** Page size for the customer search results grid. */
export const SEARCH_PAGE_SIZE = 12;

/**
 * Prisma `where` for customer catalog search over active services.
 *
 * Exported so unit tests can assert the filter shape without a database.
 * `q` must already be trimmed and length-bounded by the caller; Prisma
 * parameterises the value, so the term can never become SQL. Service name,
 * description and both relation names are searched, so a query like "AC" or
 * "electrical" surfaces the right services and categories.
 *
 * An empty term deliberately matches NOTHING (an `in: []` sentinel) rather
 * than everything - a blank search box must not dump the whole catalogue.
 */
export function catalogSearchWhere(q: string): Record<string, unknown> {
  const term = q.trim();
  if (!term) return { id: { in: [] } };
  return {
    isActive: true,
    OR: [
      { name: { contains: term } },
      { description: { contains: term } },
      { subCategory: { name: { contains: term } } },
      { subCategory: { category: { name: { contains: term } } } },
    ],
  };
}

/**
 * One page of catalog search results, cheapest-first published price, newest
 * listing rules identical to the category page: only ACTIVE services, ordered
 * by name, `priceFromPaise` is the lowest published active option or null.
 */
export async function searchServices(term: string, page = 1) {
  const q = term.trim();
  const currentPage = Number.isFinite(page) && page > 1 ? Math.floor(page) : 1;

  // A blank term never reaches the database.
  if (!q) {
    return { total: 0, page: currentPage, hasMore: false, services: [] };
  }

  const where = catalogSearchWhere(q);
  const [rows, total] = await Promise.all([
    prisma.service.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (currentPage - 1) * SEARCH_PAGE_SIZE,
      // One extra row is a cheap "is there a next page" sentinel.
      take: SEARCH_PAGE_SIZE + 1,
      select: {
        id: true,
        name: true,
        slug: true,
        serviceType: true,
        description: true,
        options: {
          where: { isActive: true },
          select: { charging: true, pricePaise: true },
        },
        subCategory: { select: { category: { select: { name: true, slug: true } } } },
      },
    }),
    prisma.service.count({ where }),
  ]);

  const hasMore = rows.length > SEARCH_PAGE_SIZE;
  const pageRows = rows.slice(0, SEARCH_PAGE_SIZE);

  return {
    total,
    page: currentPage,
    hasMore,
    services: pageRows.map((s) => {
      // Same "lowest published price" rule as getCategoryBySlug.
      const priced = s.options
        .map((o) => o.pricePaise)
        .filter((p): p is number => p != null && p > 0);
      return {
        id: s.id,
        name: s.name,
        slug: s.slug,
        serviceType: s.serviceType,
        description: s.description,
        categoryName: s.subCategory.category.name,
        categorySlug: s.subCategory.category.slug,
        priceFromPaise: priced.length > 0 ? Math.min(...priced) : null,
      };
    }),
  };
}
