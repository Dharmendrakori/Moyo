/// <reference types="vitest/globals" />

/**
 * PAYMENT ROUTE TESTS
 *
 * These drive the REAL route handlers end to end: the genuine guard chain
 * (same-origin -> session -> CSRF -> rate limit -> strict Zod), the real
 * `RazorpayProvider` HTTP shapes, the real ledger validation and the real
 * transactional writes.
 *
 * Two things are fake, and only two:
 *  - Prisma (`tests/stubs/payment-store.ts`, an in-memory ledger that honors the
 *    conditional updates and unique constraints the safety properties depend on)
 *  - the network (`fetch`), which answers with the gateway's documented payloads.
 *
 * The HMAC signatures in this file are computed with the real algorithm, so the
 * verification path under test is the one that runs in production.
 */

import { createHmac } from 'node:crypto';
import { resetSessions, signIn } from './stubs/session-control';
import { createPaymentStore } from './stubs/payment-store';
import { resetRateLimit } from '../src/lib/rate-limit';

const store = createPaymentStore();

vi.mock('@/lib/prisma', () => ({ prisma: store.makePrismaMock() }));
vi.mock('../src/lib/prisma', () => ({ prisma: store.makePrismaMock() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

const KEY_ID = 'rzp_test_keyid';
const KEY_SECRET = 'rzp_test_secret_value';
const WEBHOOK_SECRET = 'rzp_test_webhook_secret';
const ORDER_ID = 'order_TESTORDER0001';
const PAYMENT_ID = 'pay_TESTPAYMENT0001';

const ADMIN_ID = 'cadmin0000000000000000001';
const CUSTOMER_ID = 'ccustomer00000000000000001';
const OTHER_CUSTOMER_ID = 'ccustomer00000000000000009';
const BOOKING_ID = 'cbooking0000000000000001';
const INVOICE_ID = 'cinvoice00000000000000001';
const ORIGIN = 'http://localhost:3000';
const CSRF = 'csrf-token';

// --- gateway stub -----------------------------------------------------------

type GatewayCall = { url: string; method: string; auth: string; body: unknown };

const gateway = {
  calls: [] as GatewayCall[],
  orderResponse: {
    id: ORDER_ID,
    entity: 'order',
    amount: 149_900,
    currency: 'INR',
    status: 'created',
  } as Record<string, unknown>,
  paymentResponse: {} as Record<string, unknown>,
  orderStatus: 200,
  paymentStatus: 200,
  paymentThrows: false,
};

function capturedPayment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PAYMENT_ID,
    entity: 'payment',
    amount: 149_900,
    currency: 'INR',
    status: 'captured',
    order_id: ORDER_ID,
    captured: true,
    amount_refunded: 0,
    refund_status: null,
    error_code: null,
    error_description: null,
    ...overrides,
  };
}

function installGateway(): void {
  gateway.calls = [];
  gateway.orderResponse = {
    id: ORDER_ID,
    entity: 'order',
    amount: 149_900,
    currency: 'INR',
    status: 'created',
  };
  gateway.paymentResponse = capturedPayment();
  gateway.orderStatus = 200;
  gateway.paymentStatus = 200;
  gateway.paymentThrows = false;

  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    gateway.calls.push({
      url: String(url),
      method,
      auth: String((init.headers as Record<string, string>)?.Authorization ?? ''),
      body,
    });

    if (String(url).endsWith('/orders')) {
      return new Response(JSON.stringify(gateway.orderResponse), {
        status: gateway.orderStatus,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (gateway.paymentThrows) throw new TypeError('network down');

    return new Response(JSON.stringify(gateway.paymentResponse), {
      status: gateway.paymentStatus,
      headers: { 'content-type': 'application/json' },
    });
  });
}

/** The gateway's documented checkout signature: HMAC-SHA256(order|payment, secret). */
const signCheckout = (orderId: string, paymentId: string, secret = KEY_SECRET) =>
  createHmac('sha256', secret).update(`${orderId}|${paymentId}`, 'utf8').digest('hex');

// --- helpers ----------------------------------------------------------------

async function loadInitiate() {
  vi.resetModules();
  return (await import('../src/app/api/bookings/[id]/payment/route')).POST;
}

async function loadVerify() {
  vi.resetModules();
  return (await import('../src/app/api/bookings/[id]/payment/verify/route')).POST;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const post = (path: string, body: unknown = {}, origin = ORIGIN, csrf: string | null = CSRF) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
    },
    body: JSON.stringify(body),
  });

const initiatePath = (id = BOOKING_ID) => `/api/bookings/${id}/payment`;
const verifyPath = (id = BOOKING_ID) => `/api/bookings/${id}/payment/verify`;

function seedPayableInvoice(overrides: Partial<Parameters<typeof store.seedInvoice>[0]> = {}) {
  store.seedBooking({ id: BOOKING_ID });
  return store.seedInvoice({ id: INVOICE_ID, bookingId: BOOKING_ID, ...overrides });
}

/** Seeds the attempt a real first click would have created. */
function seedAttempt(overrides: Record<string, unknown> = {}) {
  return store.seedPayment({
    idempotencyKey: `invoice:${INVOICE_ID}`,
    invoiceId: INVOICE_ID,
    gatewayOrderId: ORDER_ID,
    ...overrides,
  });
}

const invoiceRow = () => store.invoiceRows().find((row) => row.id === INVOICE_ID)!;
const paymentRow = () => store.rows()[0];

beforeEach(() => {
  resetSessions();
  resetRateLimit();
  store.reset();
  installGateway();
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe('POST /api/bookings/:id/payment: authorization', () => {
  it('rejects an unauthenticated caller and creates nothing', async () => {
    seedPayableInvoice();
    const initiate = await loadInitiate();

    const res = await initiate(post(initiatePath()), params(BOOKING_ID));

    expect(res.status).toBe(401);
    expect(store.rows()).toHaveLength(0);
    expect(gateway.calls).toHaveLength(0);
  });

  it('rejects a cross-origin request', async () => {
    seedPayableInvoice();
    const initiate = await loadInitiate();
    signIn(CUSTOMER_ID);

    const res = await initiate(
      post(initiatePath(), {}, 'https://evil.example'),
      params(BOOKING_ID),
    );

    expect(res.status).toBe(403);
    expect(gateway.calls).toHaveLength(0);
  });

  it('rejects a request without the CSRF token', async () => {
    seedPayableInvoice();
    const initiate = await loadInitiate();
    signIn(CUSTOMER_ID);

    const res = await initiate(post(initiatePath(), {}, ORIGIN, null), params(BOOKING_ID));

    expect(res.status).toBe(403);
    expect(gateway.calls).toHaveLength(0);
  });

  it("answers 404 for another customer's invoice and never calls the gateway", async () => {
    seedPayableInvoice();
    const initiate = await loadInitiate();
    signIn(OTHER_CUSTOMER_ID);

    const res = await initiate(post(initiatePath()), params(BOOKING_ID));

    expect(res.status).toBe(404);
    expect(store.rows()).toHaveLength(0);
    expect(gateway.calls).toHaveLength(0);
  });

  it('answers 404 for an ADMIN, because an administrator owns no invoice', async () => {
    seedPayableInvoice();
    const initiate = await loadInitiate();
    signIn(ADMIN_ID);

    const res = await initiate(post(initiatePath()), params(BOOKING_ID));
    expect(res.status).toBe(404);
  });

  it('answers 404 for a malformed booking id', async () => {
    seedPayableInvoice();
    const initiate = await loadInitiate();
    signIn(CUSTOMER_ID);

    const res = await initiate(post(initiatePath('not-a-cuid')), params('not-a-cuid'));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Initiation and amount integrity
// ---------------------------------------------------------------------------

describe('POST /api/bookings/:id/payment: initiation', () => {
  it('creates a gateway order for the PERSISTED invoice amount', async () => {
    seedPayableInvoice({ totalPaise: 234_567 });
    // The gateway order must echo the same amount the invoice persists.
    gateway.orderResponse = { ...gateway.orderResponse, amount: 234_567 };
    const initiate = await loadInitiate();
    signIn(CUSTOMER_ID);

    const res = await initiate(post(initiatePath()), params(BOOKING_ID));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      orderId: ORDER_ID,
      amountPaise: 234_567,
      currency: 'INR',
      keyId: KEY_ID,
      invoiceNumber: 'SERIC-INV-2026-000001',
    });

    // Only the publishable key id may reach the browser.
    expect(JSON.stringify(body)).not.toContain(KEY_SECRET);

    const orderCall = gateway.calls.find((call) => call.url.endsWith('/orders'))!;
    expect(orderCall.method).toBe('POST');
    expect(orderCall.body).toMatchObject({
      amount: 234_567,
      currency: 'INR',
      receipt: 'SERIC-INV-2026-000001',
      partial_payment: false,
    });
    // HTTP Basic with the key pair; the secret is never a query parameter.
    expect(orderCall.auth).toBe(
      `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`,
    );

    expect(paymentRow()).toMatchObject({
      status: 'PENDING',
      gatewayOrderId: ORDER_ID,
      amountPaise: 234_567,
      currency: 'INR',
    });
  });

  it('refuses an already-paid invoice and never opens checkout', async () => {
    seedPayableInvoice({ status: 'PAID' });
    const initiate = await loadInitiate();
    signIn(CUSTOMER_ID);

    const res = await initiate(post(initiatePath()), params(BOOKING_ID));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'ALREADY_PAID' } });
    expect(gateway.calls).toHaveLength(0);
  });

  it('refuses a void or draft invoice', async () => {
    seedPayableInvoice({ status: 'VOID' });
    const initiate = await loadInitiate();
    signIn(CUSTOMER_ID);

    const voidRes = await initiate(post(initiatePath()), params(BOOKING_ID));
    expect(voidRes.status).toBe(409);
    expect(await voidRes.json()).toMatchObject({ error: { code: 'VOID' } });

    store.reset();
    seedPayableInvoice({ status: 'DRAFT' });
    const draftInitiate = await loadInitiate();
    signIn(CUSTOMER_ID);
    const draftRes = await draftInitiate(post(initiatePath()), params(BOOKING_ID));
    expect(draftRes.status).toBe(409);
    expect(await draftRes.json()).toMatchObject({ error: { code: 'NOT_ISSUED' } });
  });

  it('rejects a body that tries to supply an amount or a currency', async () => {
    seedPayableInvoice();
    const initiate = await loadInitiate();
    signIn(CUSTOMER_ID);

    const res = await initiate(
      post(initiatePath(), { amount: 100, currency: 'USD' }),
      params(BOOKING_ID),
    );

    expect(res.status).toBe(422);
    expect(store.rows()).toHaveLength(0);
    expect(gateway.calls).toHaveLength(0);
  });

  it('is idempotent: a repeated initiation reuses the same order', async () => {
    seedPayableInvoice();
    const initiate = await loadInitiate();
    signIn(CUSTOMER_ID);

    const first = (await (await initiate(post(initiatePath()), params(BOOKING_ID))).json()) as {
      orderId: string;
    };
    const second = (await (await initiate(post(initiatePath()), params(BOOKING_ID))).json()) as {
      orderId: string;
    };

    expect(first.orderId).toBe(ORDER_ID);
    expect(second.orderId).toBe(ORDER_ID);
    expect(store.rows()).toHaveLength(1);
    expect(gateway.calls.filter((call) => call.url.endsWith('/orders'))).toHaveLength(1);
  });

  it('fails safely when the gateway is not configured', async () => {
    seedPayableInvoice();
    process.env.RAZORPAY_KEY_SECRET = '';
    const initiate = await loadInitiate();
    signIn(CUSTOMER_ID);

    const res = await initiate(post(initiatePath()), params(BOOKING_ID));

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_CONFIGURED' } });
    expect(gateway.calls).toHaveLength(0);
    expect(store.rows()).toHaveLength(0);
  });

  it('does not persist a chargeable order when the gateway rejects the order', async () => {
    seedPayableInvoice();
    gateway.orderStatus = 500;
    const initiate = await loadInitiate();
    signIn(CUSTOMER_ID);

    const res = await initiate(post(initiatePath()), params(BOOKING_ID));

    expect(res.status).toBe(502);
    expect(paymentRow()).toMatchObject({ status: 'CREATED', gatewayOrderId: null });
    expect(invoiceRow().status).toBe('ISSUED');
  });

  it('refuses to use an order whose amount differs from the invoice', async () => {
    seedPayableInvoice({ totalPaise: 149_900 });
    gateway.orderResponse = { ...gateway.orderResponse, amount: 1 };
    const initiate = await loadInitiate();
    signIn(CUSTOMER_ID);

    const res = await initiate(post(initiatePath()), params(BOOKING_ID));

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: 'AMOUNT_MISMATCH' } });
    expect(paymentRow().gatewayOrderId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

describe('POST /api/bookings/:id/payment/verify', () => {
  const callback = (overrides: Record<string, unknown> = {}) => ({
    razorpay_order_id: ORDER_ID,
    razorpay_payment_id: PAYMENT_ID,
    razorpay_signature: signCheckout(ORDER_ID, PAYMENT_ID),
    ...overrides,
  });

  async function verify(overrides: Record<string, unknown> = {}) {
    const handler = await loadVerify();
    signIn(CUSTOMER_ID);
    return handler(post(verifyPath(), callback(overrides)), params(BOOKING_ID));
  }

  it('settles a captured payment and marks the invoice paid exactly once', async () => {
    seedPayableInvoice();
    seedAttempt();

    const res = await verify();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'CAPTURED', invoiceStatus: 'PAID' });

    expect(paymentRow()).toMatchObject({
      status: 'CAPTURED',
      gatewayPaymentId: PAYMENT_ID,
      signatureVerified: true,
    });
    expect(paymentRow().verifiedAt).toBeInstanceOf(Date);
    expect(invoiceRow().status).toBe('PAID');
    expect(invoiceRow().paidAt).toBeInstanceOf(Date);

    // The booking advances along its legal edge, logged once.
    expect(store.statusEvents()).toEqual([
      { bookingId: BOOKING_ID, from: 'PAYMENT_PENDING', to: 'PAID' },
    ]);
    expect(store.notifications()).toHaveLength(1);
  });

  it('rejects an invalid signature and leaves the invoice unpaid', async () => {
    seedPayableInvoice();
    seedAttempt();

    const res = await verify({ razorpay_signature: 'a'.repeat(64) });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_SIGNATURE' } });
    expect(invoiceRow().status).toBe('ISSUED');
    expect(paymentRow().status).toBe('PENDING');
    // The signature gates the gateway fetch too: nothing was retrieved.
    expect(gateway.calls.filter((call) => call.method === 'GET')).toHaveLength(0);
    expect(store.audits().some((a) => a.action === 'PAYMENT_VERIFICATION_FAILED')).toBe(true);
  });

  it('rejects a signature produced for a different order', async () => {
    seedPayableInvoice();
    seedAttempt();

    const res = await verify({
      razorpay_signature: signCheckout('order_OTHERORDER0002', PAYMENT_ID),
    });

    expect(res.status).toBe(400);
    expect(invoiceRow().status).toBe('ISSUED');
  });

  it('rejects an amount mismatch reported by the gateway', async () => {
    seedPayableInvoice();
    seedAttempt();
    gateway.paymentResponse = capturedPayment({ amount: 100 });

    const res = await verify();

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'AMOUNT_MISMATCH' } });
    expect(invoiceRow().status).toBe('ISSUED');
    expect(paymentRow().status).toBe('PENDING');
  });

  it('rejects a currency mismatch reported by the gateway', async () => {
    seedPayableInvoice();
    seedAttempt();
    gateway.paymentResponse = capturedPayment({ currency: 'USD' });

    const res = await verify();

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'CURRENCY_MISMATCH' } });
    expect(invoiceRow().status).toBe('ISSUED');
  });

  it('rejects a payment that belongs to another order', async () => {
    seedPayableInvoice();
    seedAttempt();
    gateway.paymentResponse = capturedPayment({ order_id: 'order_OTHERORDER0002' });

    const res = await verify();

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'ORDER_MISMATCH' } });
    expect(invoiceRow().status).toBe('ISSUED');
  });

  it('records a failed payment and leaves the invoice unpaid', async () => {
    seedPayableInvoice();
    seedAttempt();
    gateway.paymentResponse = capturedPayment({
      status: 'failed',
      captured: false,
      error_code: 'BAD_REQUEST_ERROR',
      error_description: 'Payment declined by the bank.',
    });

    const res = await verify();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'FAILED', invoiceStatus: 'ISSUED' });
    expect(paymentRow()).toMatchObject({ status: 'FAILED', failureCode: 'BAD_REQUEST_ERROR' });
    expect(invoiceRow().status).toBe('ISSUED');
  });

  it('does not mark the invoice paid for an AUTHORIZED (not captured) payment', async () => {
    seedPayableInvoice();
    seedAttempt();
    gateway.paymentResponse = capturedPayment({ status: 'authorized', captured: false });

    const res = await verify();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'AUTHORIZED', invoiceStatus: 'ISSUED' });
    expect(paymentRow().status).toBe('AUTHORIZED');
    expect(invoiceRow().status).toBe('ISSUED');
  });

  it('answers 404 for an order this application never issued', async () => {
    seedPayableInvoice();

    const res = await verify({ razorpay_order_id: 'order_UNKNOWN00001' });

    expect(res.status).toBe(404);
    expect(invoiceRow().status).toBe('ISSUED');
    expect(gateway.calls).toHaveLength(0);
  });

  it('cannot be used by another customer', async () => {
    seedPayableInvoice();
    seedAttempt();

    const handler = await loadVerify();
    signIn(OTHER_CUSTOMER_ID);
    const res = await handler(post(verifyPath(), callback()), params(BOOKING_ID));

    expect(res.status).toBe(404);
    expect(invoiceRow().status).toBe('ISSUED');
  });

  it('rejects malformed gateway identifiers before they reach the gateway', async () => {
    seedPayableInvoice();
    seedAttempt();

    const res = await verify({ razorpay_payment_id: '../../v1/payments' });

    expect(res.status).toBe(422);
    expect(gateway.calls).toHaveLength(0);
  });

  it('reports a gateway outage as 502 without changing anything', async () => {
    seedPayableInvoice();
    seedAttempt();
    gateway.paymentThrows = true;

    const res = await verify();

    expect(res.status).toBe(502);
    expect(invoiceRow().status).toBe('ISSUED');
    expect(paymentRow().status).toBe('PENDING');
  });

  it('is idempotent: a replayed callback pays the invoice once', async () => {
    seedPayableInvoice();
    seedAttempt();

    const first = await verify();
    const second = await verify();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: 'CAPTURED', changed: false });
    expect(store.statusEvents()).toHaveLength(1);
    expect(store.notifications()).toHaveLength(1);
  });

  it('stays consistent when two callbacks arrive together', async () => {
    seedPayableInvoice();
    seedAttempt();
    const handler = await loadVerify();
    signIn(CUSTOMER_ID);

    const [a, b] = await Promise.all([
      handler(post(verifyPath(), callback()), params(BOOKING_ID)),
      handler(post(verifyPath(), callback()), params(BOOKING_ID)),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(store.statusEvents()).toHaveLength(1);
    expect(invoiceRow().status).toBe('PAID');
    expect(store.rows()).toHaveLength(1);
  });
});
