/// <reference types="vitest/globals" />

/**
 * ADMIN CATALOG AND PRICING RULE TESTS
 *
 * Authorization is covered in `admin-auth.test.ts`. This file covers the
 * commercial and data-integrity rules that an authorised ADMIN is still subject
 * to:
 *
 *   - strict input validation, including rejection of mass-assignment attempts
 *   - published vs unpublished pricing, and what a customer may see
 *   - Customer Budget keeping its min/max/range semantics
 *   - historical booking prices never being rewritten by a price change
 *   - every commercial mutation writing the correct audit action
 */

import { resetSessions, sessionState, signIn } from './stubs/session-control';

vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

const auditRows: Array<{ action: string; entityType: string; metadata: string | null }> = [];

/**
 * Stand-in bookings that already hold an agreed quote. The mock's `booking`
 * model THROWS on any write, so if a price mutation ever tried to rewrite one
 * of these the test would fail loudly rather than silently pass.
 */
const bookingRows: Array<{ id: string; serviceId: string; charging: string; quotedPaise: number }> = [];

const optionRows: Array<Record<string, unknown>> = [];

const ADMIN_ID = 'cadmin0000000000000000001';
const OPTION_ID = 'coption0000000000000000001';
const SERVICE_ID = 'cservice0000000000000000001';

function makePrismaMock() {
  const now = new Date();
  return {
    session: {
      findUnique: async () => {
        const userId = sessionState.currentUserId;
        if (!userId) return null;
        return {
          csrfToken: sessionState.csrfByUserId.get(userId) ?? 'csrf-token',
          revokedAt: null,
          expiresAt: new Date(now.getTime() + 3_600_000),
          userId,
          user: {
            id: userId,
            name: 'Ops Admin',
            email: 'admin@example.com',
            phone: '9876543210',
            role: 'ADMIN',
            isActive: true,
            provider: null,
            technician: null,
          },
        };
      },
    },
    serviceOption: {
      findMany: async () => optionRows,
      count: async () => optionRows.length,
      /**
       * Returns a COPY, not the live row.
       *
       * The write models read the current state, then update, then record the
       * PREVIOUS value in the audit trail. If the mock handed back the same
       * object reference, `Object.assign` in `update` would mutate the snapshot
       * before it was read and every "previous" value would be wrong - the test
       * would silently stop testing what it claims to test.
       */
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = optionRows.find((o) => o.id === where.id);
        return row ? { ...row } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = optionRows.find((o) => o.id === where.id);
        if (!row) return null;
        Object.assign(row, data);
        return { ...row };
      },
    },
    booking: {
      count: async () => bookingRows.length,
      // A price change must never write to a booking. These guards make that a
      // hard failure rather than something a future edit could quietly break.
      update: async () => {
        throw new Error('admin pricing must never update a booking');
      },
      updateMany: async () => {
        throw new Error('admin pricing must never updateMany a booking');
      },
      delete: async () => {
        throw new Error('admin pricing must never delete a booking');
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditRows.push({
          action: data.action as string,
          entityType: data.entityType as string,
          metadata: (data.metadata as string) ?? null,
        });
        return undefined;
      },
    },
  };
}

const ORIGIN = 'http://localhost:3000';
const CSRF = { 'x-csrf-token': 'csrf-token' };

function patch(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function seedOption(overrides: Record<string, unknown> = {}) {
  const row = {
    id: OPTION_ID,
    serviceId: SERVICE_ID,
    charging: 'VISIT_CHARGE',
    pricePaise: null as number | null,
    budgetMinPaise: null as number | null,
    budgetMaxPaise: null as number | null,
    durationMinMinutes: null as number | null,
    isActive: true,
    service: { id: SERVICE_ID, isActive: true },
    ...overrides,
  };
  optionRows.push(row);
  return row;
}

async function loadPricing() {
  const route = await import('../src/app/api/admin/pricing/[id]/route');
  const options = await import('../src/app/api/admin/charging-options/[id]/route');
  return { updatePrice: route.PATCH, updateOption: options.PATCH };
}

beforeEach(() => {
  resetSessions();
  vi.resetModules();
  auditRows.length = 0;
  optionRows.length = 0;
  bookingRows.length = 0;
  signIn(ADMIN_ID);
});
// ---------------------------------------------------------------------------
// Publishing and withdrawing prices
// ---------------------------------------------------------------------------

describe('published pricing', () => {
  it('publishes a validated price and audits it as PRICE_PUBLISHED', async () => {
    const { updatePrice } = await loadPricing();
    const row = seedOption();
    const res = await updatePrice(
      patch(`/api/admin/pricing/${OPTION_ID}`, { action: 'PUBLISH', pricePaise: 49_900 }, CSRF),
      ctx(OPTION_ID),
    );
    expect(res.status).toBe(200);
    expect(row.pricePaise).toBe(49_900);
    expect(auditRows[0]?.action).toBe('PRICE_PUBLISHED');
    expect(JSON.parse(auditRows[0]?.metadata ?? '{}')).toMatchObject({
      previousPricePaise: null,
      pricePaise: 49_900,
    });
  });

  it('withdraws a price to null and audits it as PRICE_UNPUBLISHED', async () => {
    const { updatePrice } = await loadPricing();
    const row = seedOption({ pricePaise: 49_900 });
    const res = await updatePrice(
      patch(`/api/admin/pricing/${OPTION_ID}`, { action: 'UNPUBLISH' }, CSRF),
      ctx(OPTION_ID),
    );
    expect(res.status).toBe(200);
    // NULL, not a zero and not a deletion: NULL is what the customer UI already
    // renders as its neutral "on request" state.
    expect(row.pricePaise).toBeNull();
    expect(auditRows[0]?.action).toBe('PRICE_UNPUBLISHED');
  });

  it('rejects a negative, zero, fractional or over-ceiling price', async () => {
    const { updatePrice } = await loadPricing();
    seedOption();
    for (const pricePaise of [-1, 0, 99, 12.5, 1_00_00_00_000]) {
      const res = await updatePrice(
        patch(`/api/admin/pricing/${OPTION_ID}`, { action: 'PUBLISH', pricePaise }, CSRF),
        ctx(OPTION_ID),
      );
      expect(res.status, `pricePaise=${pricePaise}`).toBe(422);
    }
    expect(optionRows[0]?.pricePaise).toBeNull();
    expect(auditRows).toHaveLength(0);
  });

  it('rejects PUBLISH with no price and UNPUBLISH carrying one', async () => {
    const { updatePrice } = await loadPricing();
    seedOption();
    const missing = await updatePrice(
      patch(`/api/admin/pricing/${OPTION_ID}`, { action: 'PUBLISH' }, CSRF),
      ctx(OPTION_ID),
    );
    const contradictory = await updatePrice(
      patch(
        `/api/admin/pricing/${OPTION_ID}`,
        { action: 'UNPUBLISH', pricePaise: 100_000 },
        CSRF,
      ),
      ctx(OPTION_ID),
    );
    // Refusing the contradiction matters: silently ignoring the figure would make
    // the audit trail describe a change that was not the one requested.
    expect(missing.status).toBe(422);
    expect(contradictory.status).toBe(422);
  });

  /**
   * MASS-ASSIGNMENT DEFENCE.
   *
   * The schema is `.strict()`, so an unexpected key rejects the whole request
   * rather than being ignored. An ignored key would leave the caller believing a
   * change had been made when it had not.
   */
  it('rejects unknown fields instead of silently ignoring them', async () => {
    const { updatePrice } = await loadPricing();
    const row = seedOption();
    const attempts = [
      { action: 'PUBLISH', pricePaise: 100_000, serviceId: 'csomeotherservice000000000000' },
      { action: 'PUBLISH', pricePaise: 100_000, isActive: false },
      { action: 'PUBLISH', pricePaise: 100_000, id: 'cother00000000000000000000001' },
      { action: 'PUBLISH', pricePaise: 100_000, role: 'ADMIN' },
      { action: 'PUBLISH', pricePaise: 100_000, budgetMinPaise: 1_000 },
    ];
    for (const body of attempts) {
      const res = await updatePrice(
        patch(`/api/admin/pricing/${OPTION_ID}`, body, CSRF),
        ctx(OPTION_ID),
      );
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    }
    // Only the URL-selected row was targeted, and it is untouched.
    expect(row.pricePaise).toBeNull();
    expect(optionRows).toHaveLength(1);
    expect(auditRows).toHaveLength(0);
  });

  it('refuses to publish a price for a disabled option', async () => {
    const { updatePrice } = await loadPricing();
    const row = seedOption({ isActive: false });
    const res = await updatePrice(
      patch(`/api/admin/pricing/${OPTION_ID}`, { action: 'PUBLISH', pricePaise: 100_000 }, CSRF),
      ctx(OPTION_ID),
    );
    // A price the booking domain would reject as unavailable must never be
    // visible to a customer, so the server blocks it at publication time.
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('OPTION_DISABLED');
    expect(row.pricePaise).toBeNull();
  });

  it('refuses to publish a price for a deactivated service', async () => {
    const { updatePrice } = await loadPricing();
    seedOption({ service: { id: SERVICE_ID, isActive: false } });
    const res = await updatePrice(
      patch(`/api/admin/pricing/${OPTION_ID}`, { action: 'PUBLISH', pricePaise: 100_000 }, CSRF),
      ctx(OPTION_ID),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('SERVICE_INACTIVE');
  });

  /**
   * CUSTOMER BUDGET CARRIES NO FIXED PRICE.
   *
   * In that mode the customer states a budget and the provider confirms scope;
   * `resolveBookingPricing` always returns `quotedPaise: null`. A published
   * figure would advertise a number that can never be quoted.
   */
  it('refuses to publish a fixed price against Customer Budget', async () => {
    const { updatePrice } = await loadPricing();
    const row = seedOption({ charging: 'CUSTOMER_BUDGET' });
    const res = await updatePrice(
      patch(`/api/admin/pricing/${OPTION_ID}`, { action: 'PUBLISH', pricePaise: 100_000 }, CSRF),
      ctx(OPTION_ID),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('PRICE_NOT_APPLICABLE');
    expect(row.pricePaise).toBeNull();
    expect(auditRows).toHaveLength(0);
  });
});
// ---------------------------------------------------------------------------
// Historical booking prices are never silently modified
// ---------------------------------------------------------------------------

describe('historical booking pricing', () => {
  /**
   * A booking stores the price it was quoted at creation time. Re-pricing the
   * catalogue must NOT rewrite an agreed quote.
   *
   * This is asserted two ways at once: the booking row's value is checked
   * before and after, AND the mock's booking model throws on any write. A
   * future refactor that started updating bookings would fail loudly here rather
   * than quietly changing historical prices.
   */
  it('leaves an existing booking quote untouched when a price changes', async () => {
    const { updatePrice } = await loadPricing();
    const row = seedOption({ pricePaise: 30_000 });
    bookingRows.push({
      id: 'b-1',
      serviceId: SERVICE_ID,
      charging: 'VISIT_CHARGE',
      quotedPaise: 30_000,
    });

    const res = await updatePrice(
      patch(`/api/admin/pricing/${OPTION_ID}`, { action: 'PUBLISH', pricePaise: 45_000 }, CSRF),
      ctx(OPTION_ID),
    );

    expect(res.status).toBe(200);
    expect(row.pricePaise).toBe(45_000);
    // The catalogue moved; the historical quote did not.
    expect(bookingRows[0]?.quotedPaise).toBe(30_000);
    expect(bookingRows).toHaveLength(1);
  });

  it('records the blast radius in the audit metadata without touching bookings', async () => {
    const { updatePrice } = await loadPricing();
    seedOption();
    bookingRows.push({ id: 'b-1', serviceId: SERVICE_ID, charging: 'VISIT_CHARGE', quotedPaise: 30_000 });
    bookingRows.push({ id: 'b-2', serviceId: SERVICE_ID, charging: 'VISIT_CHARGE', quotedPaise: 35_000 });

    await updatePrice(
      patch(`/api/admin/pricing/${OPTION_ID}`, { action: 'PUBLISH', pricePaise: 45_000 }, CSRF),
      ctx(OPTION_ID),
    );

    const metadata = JSON.parse(auditRows[0]?.metadata ?? '{}');
    // The operator can see how many agreed quotes the change does NOT alter.
    expect(metadata.historicalBookingsUnchanged).toBe(2);
    expect(bookingRows.map((b) => b.quotedPaise)).toEqual([30_000, 35_000]);
  });
});
// ---------------------------------------------------------------------------
// Charging options: availability, budget bounds, and price separation
// ---------------------------------------------------------------------------

describe('charging options', () => {
  it('enables an option and audits it as CHARGING_OPTION_CHANGED', async () => {
    const { updateOption } = await loadPricing();
    const row = seedOption({ isActive: false });
    const res = await updateOption(
      patch(`/api/admin/charging-options/${OPTION_ID}`, { isActive: true }, CSRF),
      ctx(OPTION_ID),
    );
    expect(res.status).toBe(200);
    expect(row.isActive).toBe(true);
    expect(auditRows[0]?.action).toBe('CHARGING_OPTION_CHANGED');
  });

  /**
   * PRICE SEPARATION.
   *
   * Enabling an option must never be able to expose a price. `pricePaise` is
   * absent from this endpoint's schema, so posting it is rejected outright and
   * the published price is untouched.
   */
  it('rejects pricePaise on the charging-options endpoint', async () => {
    const { updateOption } = await loadPricing();
    const row = seedOption({ pricePaise: null });
    const res = await updateOption(
      patch(`/api/admin/charging-options/${OPTION_ID}`, { isActive: true, pricePaise: 1_000 }, CSRF),
      ctx(OPTION_ID),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    expect(row.pricePaise).toBeNull();
  });

  it('stores a valid Customer Budget range', async () => {
    const { updateOption } = await loadPricing();
    const row = seedOption({ charging: 'CUSTOMER_BUDGET' });
    const res = await updateOption(
      patch(
        `/api/admin/charging-options/${OPTION_ID}`,
        { isActive: true, budgetMinPaise: 50_000, budgetMaxPaise: 5_00_000 },
        CSRF,
      ),
      ctx(OPTION_ID),
    );
    expect(res.status).toBe(200);
    expect(row.budgetMinPaise).toBe(50_000);
    expect(row.budgetMaxPaise).toBe(5_00_000);
    expect(auditRows[0]?.action).toBe('CHARGING_OPTION_CHANGED');
  });

  /**
   * Budget bounds are meaningless for Visit Charge and Fixed Charge. Accepting
   * them there would let a stray value silently alter the semantics of a mode
   * that has no budget.
   */
  it('refuses budget bounds on a non-budget charging option', async () => {
    const { updateOption } = await loadPricing();
    const row = seedOption({ charging: 'VISIT_CHARGE' });
    const res = await updateOption(
      patch(
        `/api/admin/charging-options/${OPTION_ID}`,
        { isActive: true, budgetMinPaise: 50_000, budgetMaxPaise: 5_00_000 },
        CSRF,
      ),
      ctx(OPTION_ID),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('BUDGET_NOT_APPLICABLE');
    expect(row.isActive).toBe(true); // unchanged
    expect(auditRows).toHaveLength(0);
  });

  it('refuses to enable Customer Budget without a budget range', async () => {
    const { updateOption } = await loadPricing();
    // Seeded OFF with no bounds: exactly the state that must not be switchable
    // on, because the booking domain would reject every resulting request.
    const row = seedOption({ charging: 'CUSTOMER_BUDGET', isActive: false });
    const res = await updateOption(
      patch(`/api/admin/charging-options/${OPTION_ID}`, { isActive: true }, CSRF),
      ctx(OPTION_ID),
    );
    // Enabling a mode the booking domain always rejects would advertise
    // something customers cannot actually use.
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('BUDGET_RANGE_REQUIRED');
    expect(row.isActive).toBe(false);
  });

  it('refuses an inverted or too-narrow budget range', async () => {
    const { updateOption } = await loadPricing();
    seedOption({ charging: 'CUSTOMER_BUDGET' });
    const inverted = await updateOption(
      patch(
        `/api/admin/charging-options/${OPTION_ID}`,
        { isActive: true, budgetMinPaise: 5_00_000, budgetMaxPaise: 50_000 },
        CSRF,
      ),
      ctx(OPTION_ID),
    );
    const tooNarrow = await updateOption(
      patch(
        `/api/admin/charging-options/${OPTION_ID}`,
        { isActive: true, budgetMinPaise: 50_000, budgetMaxPaise: 50_100 },
        CSRF,
      ),
      ctx(OPTION_ID),
    );
    expect(inverted.status).toBe(422);
    expect(tooNarrow.status).toBe(422);
  });
});
