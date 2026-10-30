/// <reference types="vitest/globals" />

/**
 * ADMIN PAYMENT SCREEN TESTS
 *
 * Drives the REAL server components for `/admin/payments` and
 * `/admin/payments/[id]`, so a broken import, a throwing query or a missing guard
 * fails here instead of surfacing as a browser error.
 *
 * Only Prisma, `next/headers` and `next/navigation` are mocked.
 */

import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { resetSessions, signIn } from './stubs/session-control';
import { flattenAdminNav } from '../src/lib/admin-nav';

type PaymentSeed = {
  id: string;
  status: string;
  amountPaise: number;
  currency: string;
  provider: string;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  failureCode: string | null;
  failureReason: string | null;
  refundedPaise: number;
  refundStatus: string | null;
  signatureVerified: boolean;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  idempotencyKey: string;
  invoiceId: string;
  bookingId: string;
};

const payments: PaymentSeed[] = [];

vi.mock('@/lib/prisma', () => ({ prisma: makePrismaMock() }));
vi.mock('../src/lib/prisma', () => ({ prisma: makePrismaMock() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

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
const PAYMENT_ID = 'cpay000000000000000001';

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

function seedPayment(overrides: Partial<PaymentSeed> = {}): PaymentSeed {
  const row: PaymentSeed = {
    id: PAYMENT_ID,
    status: 'CAPTURED',
    amountPaise: 149_900,
    currency: 'INR',
    provider: 'RAZORPAY',
    gatewayOrderId: 'order_TESTORDER0001',
    gatewayPaymentId: 'pay_TESTPAYMENT0001',
    failureCode: null,
    failureReason: null,
    refundedPaise: 0,
    refundStatus: null,
    signatureVerified: true,
    verifiedAt: new Date('2026-10-30T09:30:00Z'),
    createdAt: new Date('2026-10-30T09:00:00Z'),
    updatedAt: new Date('2026-10-30T09:30:00Z'),
    idempotencyKey: 'invoice:cinvoice00000000000000001',
    invoiceId: 'cinvoice00000000000000001',
    bookingId: 'cbooking0000000000000001',
    ...overrides,
  };
  payments.push(row);
  return row;
}

function makePrismaMock() {
  const now = new Date();

  const prisma: Record<string, unknown> = {
    session: {
      findUnique: async ({ where }: { where?: { tokenHash?: string } } = {}) => {
        const userId = (
          globalThis as unknown as {
            __moyoTestSessionState?: { currentUserId: string | null };
          }
        ).__moyoTestSessionState?.currentUserId;
        if (!userId) return null;
        if (where?.tokenHash !== hash(`token-${userId}`)) return null;
        return {
          csrfToken: 'csrf-token',
          revokedAt: null,
          expiresAt: new Date(now.getTime() + 3_600_000),
          userId,
          user: {
            id: userId,
            name: 'Test User',
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
    payment: {
      findMany: async () =>
        payments.map((row) => ({
          ...row,
          invoice: {
            id: row.invoiceId,
            number: 'SERIC-INV-2026-000001',
            customer: { name: 'Asha Verma' },
          },
          booking: { id: row.bookingId, reference: 'SERIC-2026-000123' },
        })),
      count: async ({ where }: { where?: { status?: string } } = {}) =>
        where?.status ? payments.filter((p) => p.status === where.status).length : payments.length,
      aggregate: async ({ where }: { where?: { status?: string } } = {}) => ({
        _sum: {
          amountPaise: payments
            .filter((p) => (where?.status ? p.status === where.status : true))
            .reduce((sum, p) => sum + p.amountPaise, 0),
        },
      }),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = payments.find((p) => p.id === where.id);
        if (!row) return null;
        return {
          ...row,
          invoice: {
            id: row.invoiceId,
            number: 'SERIC-INV-2026-000001',
            status: 'PAID',
            totalPaise: 149_900,
            currency: 'INR',
            issuedAt: new Date('2026-10-30T09:00:00Z'),
          },
          booking: { id: row.bookingId, reference: 'SERIC-2026-000123' },
        };
      },
    },
    invoice: {
      findUnique: async () => ({ customer: { name: 'Asha Verma' } }),
    },
  };

  return prisma;
}

const params = (value: Record<string, string | string[] | undefined> = {}) => value;

async function loadListPage() {
  vi.resetModules();
  return (await import('../src/app/admin/payments/page')).default;
}

async function loadDetailPage() {
  vi.resetModules();
  return (await import('../src/app/admin/payments/[id]/page')).default;
}

beforeEach(() => {
  resetSessions();
  payments.length = 0;
});

describe('/admin/payments', () => {
  it('marks the Payments navigation item as live', () => {
    const item = flattenAdminNav().find((entry) => entry.href === '/admin/payments');
    expect(item?.status).toBe('live');
  });

  it('renders the ledger from persisted payment records', async () => {
    seedPayment();
    const Page = await loadListPage();
    signIn(ADMIN_ID);

    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params()) }));

    expect(html).toContain('pay_TESTPAYMENT0001');
    expect(html).toContain('SERIC-INV-2026-000001');
    expect(html).toContain('SERIC-2026-000123');
    expect(html).toContain('Asha Verma');
    expect(html).toContain('1,499');
    expect(html).toContain('RAZORPAY');
  });

  it('renders an honest empty state rather than sample rows', async () => {
    const Page = await loadListPage();
    signIn(ADMIN_ID);

    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params()) }));

    expect(html).toContain('No payments yet');
  });

  it('falls back to defaults for a malformed query instead of throwing', async () => {
    seedPayment();
    const Page = await loadListPage();
    signIn(ADMIN_ID);

    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve(params({ status: 'NOPE', page: 'abc' })) }),
    );

    expect(html).toContain('Payments');
  });

  it('redirects an unauthenticated visitor to sign in', async () => {
    const Page = await loadListPage();
    await expect(Page({ searchParams: Promise.resolve(params()) })).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin%2Fpayments',
    );
  });

  it('refuses a signed-in CUSTOMER', async () => {
    const Page = await loadListPage();
    signIn(CUSTOMER_ID);
    await expect(Page({ searchParams: Promise.resolve(params()) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});

describe('/admin/payments/[id]', () => {
  it('shows the transaction, gateway references and the refund policy note', async () => {
    seedPayment();
    const Page = await loadDetailPage();
    signIn(ADMIN_ID);

    const html = renderToStaticMarkup(
      await Page({ params: Promise.resolve({ id: PAYMENT_ID }) }),
    );

    expect(html).toContain('pay_TESTPAYMENT0001');
    expect(html).toContain('order_TESTORDER0001');
    expect(html).toContain('SERIC-INV-2026-000001');
    expect(html).toContain('Signature verified');
    expect(html).toContain('Refunds are not initiated from this console yet');
    // No administrative control can mark a payment successful.
    expect(html).not.toContain('Mark as paid');
  });

  it('shows the failure the gateway reported, when there is one', async () => {
    seedPayment({
      status: 'FAILED',
      gatewayPaymentId: null,
      verifiedAt: null,
      signatureVerified: false,
      failureCode: 'BAD_REQUEST_ERROR',
      failureReason: 'Payment declined by the bank.',
    });
    const Page = await loadDetailPage();
    signIn(ADMIN_ID);

    const html = renderToStaticMarkup(
      await Page({ params: Promise.resolve({ id: PAYMENT_ID }) }),
    );

    expect(html).toContain('BAD_REQUEST_ERROR');
    expect(html).toContain('Payment declined by the bank.');
  });

  it('answers not-found for a payment that does not exist', async () => {
    const Page = await loadDetailPage();
    signIn(ADMIN_ID);
    await expect(
      Page({ params: Promise.resolve({ id: 'cpay000000000000000999' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('refuses a signed-in CUSTOMER', async () => {
    seedPayment();
    const Page = await loadDetailPage();
    signIn(CUSTOMER_ID);
    await expect(Page({ params: Promise.resolve({ id: PAYMENT_ID }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});
