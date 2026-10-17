/// <reference types="vitest/globals" />

/**
 * CUSTOMER CATALOG SEARCH TESTS
 *
 * Pins the behaviour of `catalogSearchWhere` and `searchServices` in
 * src/lib/queries.ts without a database:
 *
 *  - a blank term never reaches the database and matches nothing;
 *  - the search term only ever lands inside Prisma `contains` filters, which
 *    Prisma parameterises (no string-built SQL anywhere);
 *  - pagination is real skip/take maths with a one-row `hasMore` sentinel;
 *  - `priceFromPaise` applies the same "lowest published active option" rule
 *    as the category page, and stays honestly null when nothing is published.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: { service: { findMany: vi.fn(), count: vi.fn() } },
}));

import { prisma } from '@/lib/prisma';
import { catalogSearchWhere, searchServices, SEARCH_PAGE_SIZE } from '../src/lib/queries';

const findMany = vi.mocked(prisma.service.findMany);
const count = vi.mocked(prisma.service.count);

function serviceRow(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `s${i}`,
    name: `Service ${i}`,
    slug: `service-${i}`,
    serviceType: 'REPAIR',
    description: null,
    options: [{ charging: 'VISIT_CHARGE', pricePaise: 50000 }],
    subCategory: { category: { name: 'Plumbing', slug: 'plumbing' } },
    ...overrides,
  };
}

beforeEach(() => {
  findMany.mockReset();
  count.mockReset();
});

describe('catalogSearchWhere', () => {
  it('matches NOTHING for a blank term instead of dumping the whole catalogue', () => {
    expect(catalogSearchWhere('')).toEqual({ id: { in: [] } });
    expect(catalogSearchWhere('   ')).toEqual({ id: { in: [] } });
  });

  it('restricts to active services and searches name, description and relations', () => {
    const where = catalogSearchWhere('ac');
    expect(where.isActive).toBe(true);
    const or = where.OR as Array<Record<string, unknown>>;
    expect(or).toContainEqual({ name: { contains: 'ac' } });
    expect(or).toContainEqual({ description: { contains: 'ac' } });
    expect(or).toContainEqual({ subCategory: { name: { contains: 'ac' } } });
    expect(or).toContainEqual({ subCategory: { category: { name: { contains: 'ac' } } } });
  });

  it('never interpolates the term into anything but a contains filter', () => {
    const term = "'; DROP TABLE Service;--";
    const where = catalogSearchWhere(term);
    // The raw term appears only as a `contains` value - never as a key,
    // never concatenated. Prisma binds `contains` values as parameters.
    for (const clause of where.OR as Array<Record<string, unknown>>) {
      const entry = Object.entries(clause)[0];
      expect(entry).toBeDefined();
      if (!entry) continue;
      const [key, value] = entry;
      expect(key === 'name' || key === 'description' || key === 'subCategory').toBe(true);
      expect(JSON.stringify(value)).toContain(JSON.stringify(term).slice(1, -1));
    }
  });
});

describe('searchServices', () => {
  it('never touches the database for a blank term', async () => {
    const result = await searchServices('   ');
    expect(result).toEqual({ total: 0, page: 1, hasMore: false, services: [] });
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('uses real skip/take pagination with a one-row hasMore sentinel', async () => {
    const rows = Array.from({ length: SEARCH_PAGE_SIZE + 1 }, (_, i) => serviceRow(i));
    findMany.mockResolvedValue(rows as never);
    count.mockResolvedValue(SEARCH_PAGE_SIZE + 5);

    const result = await searchServices('ac', 2);

    const args = findMany.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.skip).toBe(SEARCH_PAGE_SIZE);
    expect(args.take).toBe(SEARCH_PAGE_SIZE + 1);
    expect(args.orderBy).toEqual({ name: 'asc' });

    expect(result.total).toBe(SEARCH_PAGE_SIZE + 5);
    expect(result.page).toBe(2);
    expect(result.hasMore).toBe(true);
    // The sentinel row is trimmed from the visible results.
    expect(result.services).toHaveLength(SEARCH_PAGE_SIZE);
  });

  it('clamps invalid page numbers to page one', async () => {
    findMany.mockResolvedValue([] as never);
    count.mockResolvedValue(0);

    for (const bad of [0, -3, Number.NaN]) {
      const result = await searchServices('ac', bad);
      expect(result.page).toBe(1);
      const args = findMany.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(args.skip).toBe(0);
    }
  });

  it('reports hasMore false when the extra row is absent', async () => {
    findMany.mockResolvedValue([serviceRow(1)] as never);
    count.mockResolvedValue(1);
    const result = await searchServices('ac', 1);
    expect(result.hasMore).toBe(false);
    expect(result.services).toHaveLength(1);
  });

  it('maps rows to the ServiceCard shape with the lowest published price', async () => {
    findMany.mockResolvedValue([
      serviceRow(1, {
        options: [
          { charging: 'VISIT_CHARGE', pricePaise: 50000 },
          { charging: 'FIXED_CHARGE', pricePaise: 40000 },
          { charging: 'CUSTOMER_BUDGET', pricePaise: null },
        ],
        subCategory: { category: { name: 'Solar', slug: 'solar' } },
      }),
    ] as never);
    count.mockResolvedValue(1);

    const result = await searchServices('solar', 1);
    expect(result.services[0]).toMatchObject({
      id: 's1',
      categoryName: 'Solar',
      categorySlug: 'solar',
      // Lowest positive published price wins - never a client-supplied figure.
      priceFromPaise: 40000,
    });
  });

  it('keeps priceFromPaise honestly null when nothing positive is published', async () => {
    findMany.mockResolvedValue([
      serviceRow(1, {
        options: [
          { charging: 'VISIT_CHARGE', pricePaise: null },
          { charging: 'FIXED_CHARGE', pricePaise: 0 },
        ],
      }),
    ] as never);
    count.mockResolvedValue(1);

    const result = await searchServices('ac', 1);
    expect(result.services[0]?.priceFromPaise).toBeNull();
  });
});
