/// <reference types="vitest/globals" />

/**
 * CUSTOMER-FACING PRICE VISIBILITY
 *
 * The rule under test: a customer sees a price ONLY when the provider has
 * published one. Everything else renders the honest neutral state.
 *
 * These exercise the REAL pricing domain (`resolveBookingPricing`) - the single
 * source of truth for what a booking costs - rather than any admin code, because
 * the guarantee that matters to a customer is that the booking path and the
 * display path agree, and both read from this one function.
 */

import { PricingError, resolveBookingPricing } from '../src/lib/pricing';
import { resetSessions, signIn } from './stubs/session-control';

vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

const SERVICE_ID = 'cservice0000000000000000001';
const CUSTOMER_ID = 'ccustomer00000000000000000001';

type OptionRow = {
  serviceId: string;
  charging: string;
  pricePaise: number | null;
  budgetMinPaise: number | null;
  budgetMaxPaise: number | null;
  isActive: boolean;
};

/** The default catalogue state: two priced options plus a budget range. */
const options: OptionRow[] = [];

function makePrismaMock() {
  return {
    serviceOption: {
      // Mirrors the real lookup, including the `isActive: true` filter. An
      // option the provider has withdrawn is invisible to the booking domain,
      // which is what stops a disabled option from being quoted.
      findFirst: async ({
        where,
      }: {
        where: { serviceId: string; charging: string; isActive: boolean };
      }) => {
        const row = options.find(
          (o) =>
            o.serviceId === where.serviceId &&
            o.charging === where.charging &&
            o.isActive === where.isActive,
        );
        if (!row) return null;
        return {
          pricePaise: row.pricePaise,
          budgetMinPaise: row.budgetMinPaise,
          budgetMaxPaise: row.budgetMaxPaise,
        };
      },
    },
  };
}

beforeEach(() => {
  resetSessions();
  signIn(CUSTOMER_ID);
  options.length = 0;
  options.push(
    { serviceId: SERVICE_ID, charging: 'VISIT_CHARGE', pricePaise: 49_900, budgetMinPaise: null, budgetMaxPaise: null, isActive: true },
    { serviceId: SERVICE_ID, charging: 'FIXED_CHARGE', pricePaise: 2_50_000, budgetMinPaise: null, budgetMaxPaise: null, isActive: true },
    { serviceId: SERVICE_ID, charging: 'CUSTOMER_BUDGET', pricePaise: null, budgetMinPaise: 50_000, budgetMaxPaise: 5_00_000, isActive: true },
  );
});

// ---------------------------------------------------------------------------
// Published pricing IS customer-visible
// ---------------------------------------------------------------------------

describe('published pricing is customer-visible', () => {
  it('resolves the published visit charge from the server', async () => {
    expect((await resolveBookingPricing(SERVICE_ID, 'VISIT_CHARGE')).quotedPaise).toBe(49_900);
  });

  it('resolves the published fixed charge from the server', async () => {
    expect((await resolveBookingPricing(SERVICE_ID, 'FIXED_CHARGE')).quotedPaise).toBe(2_50_000);
  });

  it('accepts a customer budget inside the published range', async () => {
    const result = await resolveBookingPricing(SERVICE_ID, 'CUSTOMER_BUDGET', 1_00_000, 3_00_000);
    // No fixed quote exists for a budget booking: the provider confirms scope.
    expect(result.quotedPaise).toBeNull();
    expect(result.budgetMinPaise).toBe(1_00_000);
    expect(result.budgetMaxPaise).toBe(3_00_000);
  });
});
// ---------------------------------------------------------------------------
// Unpublished pricing is NOT customer-visible
// ---------------------------------------------------------------------------

describe('unpublished pricing is not customer-visible', () => {
  /** Asserts the rejection code, which is what the API maps to its response. */
  async function expectCode(fn: Promise<unknown>, code: PricingError['code']) {
    await fn.then(
      () => {
        throw new Error('expected the pricing domain to reject this request');
      },
      (err: unknown) => {
        expect(err).toBeInstanceOf(PricingError);
        expect((err as PricingError).code).toBe(code);
      },
    );
  }

  /**
   * An option whose price has been withdrawn (`pricePaise = null`) must not be
   * quotable. The customer sees the neutral state instead of a figure.
   */
  it('refuses to quote an option whose price has been withdrawn', async () => {
    options[0]!.pricePaise = null;
    await expectCode(
      resolveBookingPricing(SERVICE_ID, 'VISIT_CHARGE'),
      'PRICE_NOT_PUBLISHED',
    );
  });

  it('treats a zero price as unpublished rather than as free', async () => {
    // A zero would render as "free", so it must never be honoured as a quote.
    options[1]!.pricePaise = 0;
    await expectCode(resolveBookingPricing(SERVICE_ID, 'FIXED_CHARGE'), 'PRICE_NOT_PUBLISHED');
  });

  it('cannot quote an option the provider has switched off', async () => {
    options[0]!.isActive = false;
    await expectCode(resolveBookingPricing(SERVICE_ID, 'VISIT_CHARGE'), 'OPTION_NOT_AVAILABLE');
  });

  it('requires BOTH budget bounds for a customer budget booking', async () => {
    await expectCode(
      resolveBookingPricing(SERVICE_ID, 'CUSTOMER_BUDGET', 1_00_000, null),
      'BUDGET_REQUIRED',
    );
  });

  it('rejects a budget outside the published range', async () => {
    // Below the published floor.
    await expectCode(
      resolveBookingPricing(SERVICE_ID, 'CUSTOMER_BUDGET', 1, 3_00_000),
      'BUDGET_OUT_OF_RANGE',
    );
    // Above the published ceiling.
    await expectCode(
      resolveBookingPricing(SERVICE_ID, 'CUSTOMER_BUDGET', 1_00_000, 90_00_000),
      'BUDGET_OUT_OF_RANGE',
    );
  });

  it('rejects an inverted budget', async () => {
    await expectCode(
      resolveBookingPricing(SERVICE_ID, 'CUSTOMER_BUDGET', 3_00_000, 1_00_000),
      'BUDGET_OUT_OF_RANGE',
    );
  });

  /**
   * THE CORE SECURITY PROPERTY.
   *
   * A browser-supplied figure is never consulted. `resolveBookingPricing` takes
   * no price argument at all, so there is no parameter through which a client
   * could influence the result. Budget arguments only apply to
   * CUSTOMER_BUDGET and cannot leak into a fixed-price quote.
   */
  it('derives the price only from the database, never from caller input', async () => {
    const result = await resolveBookingPricing(SERVICE_ID, 'VISIT_CHARGE');
    const withBudgets = await resolveBookingPricing(SERVICE_ID, 'VISIT_CHARGE', 1, 1_00_000);
    expect(withBudgets.quotedPaise).toBe(result.quotedPaise);
    // Budgets are ignored entirely for a fixed-charge mode.
    expect(withBudgets.budgetMinPaise).toBeNull();
    expect(withBudgets.budgetMaxPaise).toBeNull();
  });
});

