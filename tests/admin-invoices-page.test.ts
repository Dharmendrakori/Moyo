/// <reference types="vitest/globals" />

/**
 * ADMIN INVOICE PAGE REGRESSION TESTS
 *
 * Guards the bug this suite was written for: `/admin/invoices` threw
 * `Cannot read properties of undefined (reading 'safeParse')` because the query
 * schema it imported was `undefined` at runtime.
 *
 * The first block pins the module contract - the schema is exported, is a real
 * Zod schema with a working `safeParse`, and it validates the way the page
 * assumes. The second block drives the REAL server components, so an undefined
 * schema, a broken import or a throwing parse fails a test instead of surfacing
 * as a browser runtime error.
 *
 * Only Prisma, `next/headers` and `next/navigation` are mocked.
 */

import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { resetSessions, sessionState, signIn } from './stubs/session-control';
import { adminInvoiceQuerySchema, normaliseSearchParams } from '../src/lib/validation';

vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));
vi.mock('../src/lib/prisma', () => ({ prisma: makePrismaMock() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

// The pages reach `next/navigation` through their guard. Redirect/notFound throw
// a sentinel here so a test can assert the guard fired without a real router.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));

const ADMIN_ID = 'cadmin0000000000000000001';
const CUSTOMER_ID = 'ccustomer00000000000000001';
const INVOICE_ID = 'cinvoice00000000000000001';

type InvoiceSeed = {
  id: string;
  number: string;
  status: string;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  currency: string;
  issuedAt: Date;
  createdAt: Date;
  bookingId: string;
  customerId: string;
  sellerSnapshot: string;
  customerSnapshot: string;
};

const invoices: InvoiceSeed[] = [];
const lastQuery: { findMany?: Record<string, unknown> } = {};

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

function seedInvoice(overrides: Partial<InvoiceSeed> = {}): InvoiceSeed {
  const row: InvoiceSeed = {
    id: INVOICE_ID,
    number: 'SERIC-INV-2026-000001',
    status: 'ISSUED',
    subtotalPaise: 149_900,
    taxPaise: 0,
    totalPaise: 149_900,
    currency: 'INR',
    issuedAt: new Date('2026-10-30T09:00:00Z'),
    createdAt: new Date('2026-10-30T09:00:00Z'),
    bookingId: 'cbooking0000000000000001',
    customerId: CUSTOMER_ID,
    sellerSnapshot: JSON.stringify({
      name: 'Seric Tech Solutions',
      legalName: 'Seric Tech Solutions',
      address: 'Royal Market, Bhopal',
      email: null,
      phone: null,
      gstin: null,
    }),
    customerSnapshot: JSON.stringify({
      name: 'Asha Verma',
      contactName: 'Asha Verma',
      contactPhone: '9876543210',
      address: '12 Test Street, Indiranagar, Bengaluru',
    }),
    ...overrides,
  };
  invoices.push(row);
  return row;
}

function applyWhere(where: Record<string, unknown> | undefined, row: InvoiceSeed): boolean {
  if (!where) return true;
  if (typeof where.status === 'string' && row.status !== where.status) return false;
  const or = where.OR as Array<Record<string, unknown>> | undefined;
  if (or) {
    const contains = (value: unknown): string | null => {
      const inner = (value as { contains?: string } | undefined)?.contains;
      return typeof inner === 'string' ? inner : null;
    };
    return or.some((clause) => {
      const number = contains(clause.number);
      return number ? row.number.includes(number) : false;
    });
  }
  return true;
}

function makePrismaMock() {
  const now = new Date();
  const prisma: Record<string, unknown> = {
    session: {
      findUnique: async ({ where }: { where?: { tokenHash?: string } } = {}) => {
        const userId = sessionState.currentUserId;
        if (!userId) return null;
        if (where?.tokenHash !== hash(`token-${userId}`)) return null;
        return {
          csrfToken: sessionState.csrfByUserId.get(userId) ?? 'csrf-token',
          revokedAt: null,
          expiresAt: new Date(now.getTime() + 3_600_000),
          userId,
          user: {
            id: userId,
            name: userId === ADMIN_ID ? 'Ops Admin' : 'Test Customer',
            email: `${userId}@example.com`,
            phone: '9876543210',
            role: userId === ADMIN_ID ? 'ADMIN' : 'CUSTOMER',
            isActive: true,
            provider: null,
            technician: null,
          },
        };
      },
    },
    invoice: {
      findMany: async (args: Record<string, unknown> = {}) => {
        lastQuery.findMany = args;
        const where = args.where as Record<string, unknown> | undefined;
        const skip = (args.skip as number) ?? 0;
        const take = (args.take as number) ?? 20;
        return invoices
          .filter((row) => applyWhere(where, row))
          .slice(skip, skip + take)
          .map((row) => ({
            id: row.id,
            number: row.number,
            status: row.status,
            totalPaise: row.totalPaise,
            currency: row.currency,
            issuedAt: row.issuedAt,
            createdAt: row.createdAt,
            booking: { id: row.bookingId, reference: 'SERIC-2026-000123' },
            customer: { name: 'Asha Verma' },
          }));
      },
      count: async ({ where }: { where?: Record<string, unknown> } = {}) =>
        invoices.filter((row) => applyWhere(where, row)).length,
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = invoices.find((candidate) => candidate.id === where.id);
        if (!row) return null;
        return {
          ...row,
          taxRateBps: 0,
          booking: { id: row.bookingId, reference: 'SERIC-2026-000123', serviceType: 'REPAIR' },
          customer: { name: 'Asha Verma' },
          lineItems: [
            {
              id: 'cline00000000000000001',
              description: 'AC Repair',
              charging: 'FIXED_CHARGE',
              quantity: 1,
              unitPaise: row.subtotalPaise,
              amountPaise: row.subtotalPaise,
            },
          ],
        };
      },
    },
    auditLog: { create: async () => undefined },
  };
  prisma.$transaction = async (fn: (tx: Record<string, unknown>) => unknown) => fn(prisma);
  return prisma;
}

/** Loads a server component fresh, with the mocks in place. */
async function loadInvoicesPage() {
  vi.resetModules();
  return (await import('../src/app/admin/invoices/page')).default;
}

async function loadInvoiceDetailPage() {
  vi.resetModules();
  return (await import('../src/app/admin/invoices/[id]/page')).default;
}

const params = (query: Record<string, string | string[]> = {}) => Promise.resolve(query);

beforeEach(() => {
  resetSessions();
  invoices.length = 0;
  delete lastQuery.findMany;
});


// ---------------------------------------------------------------------------
// The schema contract (the bug: it was undefined at runtime)
// ---------------------------------------------------------------------------

describe('adminInvoiceQuerySchema export', () => {
  it('is exported as a real Zod schema with a working safeParse', () => {
    expect(adminInvoiceQuerySchema).toBeDefined();
    expect(typeof adminInvoiceQuerySchema.safeParse).toBe('function');
    expect(typeof adminInvoiceQuerySchema.parse).toBe('function');
    expect(adminInvoiceQuerySchema.safeParse({}).success).toBe(true);
  });

  it('applies the documented defaults for an empty query', () => {
    expect(adminInvoiceQuerySchema.parse({})).toEqual({ status: 'ALL', page: 1, pageSize: 20 });
  });

  it('accepts a search term and trims/normalises it', () => {
    expect(adminInvoiceQuerySchema.parse({ q: '  SERIC-INV-2026  ' }).q).toBe('SERIC-INV-2026');
    // Control characters are stripped rather than reaching a database filter.
    expect(adminInvoiceQuerySchema.parse({ q: 'a\u0000b' }).q).toBe('ab');
  });

  it('accepts every canonical invoice status', () => {
    for (const status of ['DRAFT', 'ISSUED', 'PAID', 'VOID', 'OVERDUE', 'ALL']) {
      const parsed = adminInvoiceQuerySchema.safeParse({ status });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.status).toBe(status);
    }
  });

  it('rejects an unknown status, an unknown parameter and unsafe pagination', () => {
    for (const bad of [
      { status: 'NOPE' },
      { status: 'issued' },
      { sort: 'desc' },
      { page: 0 },
      { page: 10_001 },
      { pageSize: 0 },
      { pageSize: 1000 },
      { page: 'abc' },
    ]) {
      expect(adminInvoiceQuerySchema.safeParse(bad).success).toBe(false);
    }
  });

  it('coerces valid pagination from strings', () => {
    const parsed = adminInvoiceQuerySchema.parse({ page: '3', pageSize: '50' });
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(50);
  });
});

describe('normaliseSearchParams', () => {
  it('takes the first value of a repeated parameter', () => {
    expect(normaliseSearchParams({ status: ['ISSUED', 'PAID'], page: ['2', '3'] })).toEqual({
      status: 'ISSUED',
      page: '2',
    });
  });

  it('passes single values through and keeps absent ones undefined', () => {
    expect(normaliseSearchParams({ q: 'SERIC', status: undefined })).toEqual({
      q: 'SERIC',
      status: undefined,
    });
  });

  it('does not mutate its input', () => {
    const input = { status: ['ISSUED', 'PAID'] as string[] };
    normaliseSearchParams(input);
    expect(input.status).toHaveLength(2);
  });

  it('feeds the schema a usable record for an array-valued query', () => {
    const raw = normaliseSearchParams({ status: ['ISSUED', 'PAID'], q: ['a', 'b'] });
    expect(adminInvoiceQuerySchema.parse(raw)).toMatchObject({ status: 'ISSUED', q: 'a' });
  });
});


// ---------------------------------------------------------------------------
// The real server components
// ---------------------------------------------------------------------------

describe('/admin/invoices renders', () => {
  it('renders the ledger for an empty database without throwing', async () => {
    const AdminInvoicesPage = await loadInvoicesPage();
    signIn(ADMIN_ID);

    const html = renderToStaticMarkup(await AdminInvoicesPage({ searchParams: params() }));

    expect(html).toContain('Invoices');
    expect(html).toContain('No invoices yet');
    expect(html).not.toContain('safeParse');
  });

  it('renders an issued invoice with its number and amount', async () => {
    seedInvoice();
    const AdminInvoicesPage = await loadInvoicesPage();
    signIn(ADMIN_ID);

    const html = renderToStaticMarkup(await AdminInvoicesPage({ searchParams: params() }));

    expect(html).toContain('SERIC-INV-2026-000001');
    expect(html).toContain('1,499');
    expect(html).toContain('Asha Verma');
  });

  it('passes a validated status filter and page through to the query', async () => {
    seedInvoice();
    const AdminInvoicesPage = await loadInvoicesPage();
    signIn(ADMIN_ID);

    await AdminInvoicesPage({ searchParams: params({ status: 'ISSUED', page: '2', pageSize: '50' }) });

    expect(lastQuery.findMany?.where).toMatchObject({ status: 'ISSUED' });
    expect(lastQuery.findMany?.skip).toBe(50);
    expect(lastQuery.findMany?.take).toBe(50);
  });

  it('normalises an array-valued query before validating it', async () => {
    seedInvoice();
    const AdminInvoicesPage = await loadInvoicesPage();
    signIn(ADMIN_ID);

    await AdminInvoicesPage({ searchParams: params({ status: ['ISSUED', 'PAID'], page: ['1'] }) });

    expect(lastQuery.findMany?.where).toMatchObject({ status: 'ISSUED' });
    expect(lastQuery.findMany?.skip).toBe(0);
  });

  it('falls back to defaults for a malformed query instead of throwing', async () => {
    const AdminInvoicesPage = await loadInvoicesPage();
    signIn(ADMIN_ID);

    const html = renderToStaticMarkup(
      await AdminInvoicesPage({ searchParams: params({ status: 'NOPE', page: 'abc', sort: 'desc' }) }),
    );

    expect(html).toContain('Invoices');
    // No status constraint survived the rejection, and paging restarted at 1.
    expect(lastQuery.findMany?.where).toEqual({});
    expect(lastQuery.findMany?.skip).toBe(0);
  });

  it('still redirects an unauthenticated visitor to sign in', async () => {
    const AdminInvoicesPage = await loadInvoicesPage();
    await expect(AdminInvoicesPage({ searchParams: params() })).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin%2Finvoices',
    );
  });

  it('still refuses a signed-in CUSTOMER', async () => {
    const AdminInvoicesPage = await loadInvoicesPage();
    signIn(CUSTOMER_ID);
    await expect(AdminInvoicesPage({ searchParams: params() })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('/admin/invoices/[id] renders', () => {
  it('renders one invoice with its line items, snapshots and totals', async () => {
    seedInvoice();
    const AdminInvoiceDetailPage = await loadInvoiceDetailPage();
    signIn(ADMIN_ID);

    const html = renderToStaticMarkup(
      await AdminInvoiceDetailPage({ params: Promise.resolve({ id: INVOICE_ID }) }),
    );

    expect(html).toContain('SERIC-INV-2026-000001');
    expect(html).toContain('AC Repair');
    expect(html).toContain('Asha Verma');
    expect(html).toContain('Seric Tech Solutions');
    expect(html).toContain(`/api/admin/invoices/${INVOICE_ID}/pdf`);
    expect(html).toContain('1,499');
  });

  it('answers not-found for an invoice that does not exist', async () => {
    const AdminInvoiceDetailPage = await loadInvoiceDetailPage();
    signIn(ADMIN_ID);
    await expect(
      AdminInvoiceDetailPage({ params: Promise.resolve({ id: 'cinvoice00000000000000099' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

