/// <reference types="vitest/globals" />

/**
 * PAYMENT WEBHOOK TESTS
 *
 * The webhook is the only asynchronous path that can settle money, so these
 * tests are about exactly two things: a delivery that is not correctly signed
 * must change NOTHING, and a delivery that is correctly signed must be applied
 * at most once even though the provider retries.
 *
 * The signatures here are real HMAC-SHA256 values over the real raw body, so the
 * verification code under test is the production one.
 */

import { createHmac } from 'node:crypto';
import { createPaymentStore } from './stubs/payment-store';
import { resetRateLimit } from '../src/lib/rate-limit';

const store = createPaymentStore();

vi.mock('@/lib/prisma', () => ({ prisma: store.makePrismaMock() }));
vi.mock('../src/lib/prisma', () => ({ prisma: store.makePrismaMock() }));

const KEY_ID = 'rzp_test_keyid';
const KEY_SECRET = 'rzp_test_secret_value';
const WEBHOOK_SECRET = 'rzp_test_webhook_secret';
const ORDER_ID = 'order_TESTORDER0001';
const PAYMENT_ID = 'pay_TESTPAYMENT0001';
const REFUND_ID = 'rfnd_TESTREFUND0001';
const BOOKING_ID = 'cbooking0000000000000001';
const INVOICE_ID = 'cinvoice00000000000000001';
const ORIGIN = 'http://localhost:3000';

const sign = (body: string, secret = WEBHOOK_SECRET) =>
  createHmac('sha256', secret).update(body, 'utf8').digest('hex');

function paymentEntity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

function paymentEvent(type: string, overrides: Record<string, unknown> = {}) {
  return { event: type, payload: { payment: { entity: paymentEntity(overrides) } } };
}

function refundEvent(
  overrides: Record<string, unknown> = {},
  options: { includePayment?: boolean; amountRefunded?: number } = {},
) {
  const event: Record<string, unknown> = {
    event: 'refund.processed',
    payload: {
      refund: {
        entity: {
          id: REFUND_ID,
          entity: 'refund',
          payment_id: PAYMENT_ID,
          amount: 149_900,
          currency: 'INR',
          status: 'processed',
          ...overrides,
        },
      },
    },
  };
  if (options.includePayment) {
    (event.payload as Record<string, unknown>).payment = {
      entity: paymentEntity({ amount_refunded: options.amountRefunded ?? 149_900 }),
    };
  }
  return event;
}

async function loadWebhook() {
  vi.resetModules();
  return (await import('../src/app/api/webhooks/payment/route')).POST;
}

function deliver(
  payload: unknown,
  options: { signature?: string | null; eventId?: string | null; rawBody?: string } = {},
) {
  const rawBody = options.rawBody ?? JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const signature = options.signature === undefined ? sign(rawBody) : options.signature;
  if (signature) headers['x-razorpay-signature'] = signature;
  const eventId = options.eventId === undefined ? 'evt_TEST0001' : options.eventId;
  if (eventId) headers['x-razorpay-event-id'] = eventId;

  return new Request(`${ORIGIN}/api/webhooks/payment`, { method: 'POST', headers, body: rawBody });
}

function seedPendingPayment() {
  store.seedBooking({ id: BOOKING_ID });
  store.seedInvoice({ id: INVOICE_ID, bookingId: BOOKING_ID });
  return store.seedPayment({
    idempotencyKey: `invoice:${INVOICE_ID}`,
    invoiceId: INVOICE_ID,
    gatewayOrderId: ORDER_ID,
  });
}

// Every case in this suite seeds one invoice and at most one attempt.
const invoiceRow = () => store.invoiceRows()[0]!;
const paymentRow = () => store.rows()[0]!;

beforeEach(() => {
  resetRateLimit();
  store.reset();
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

describe('webhook signature', () => {
  it('settles a correctly signed payment.captured delivery', async () => {
    seedPendingPayment();
    const webhook = await loadWebhook();

    const res = await webhook(deliver(paymentEvent('payment.captured')));

    expect(res.status).toBe(200);
    expect(paymentRow()).toMatchObject({ status: 'CAPTURED', signatureVerified: true });
    expect(invoiceRow().status).toBe('PAID');
    expect(store.statusEvents()).toEqual([
      { bookingId: BOOKING_ID, from: 'PAYMENT_PENDING', to: 'PAID' },
    ]);
    expect(store.webhookEvents()).toHaveLength(1);
  });

  it('rejects an unsigned delivery and changes nothing', async () => {
    seedPendingPayment();
    const webhook = await loadWebhook();

    const res = await webhook(deliver(paymentEvent('payment.captured'), { signature: null }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_SIGNATURE' } });
    expect(invoiceRow().status).toBe('ISSUED');
    expect(paymentRow().status).toBe('PENDING');
    expect(store.webhookEvents()).toHaveLength(0);
  });

  it('rejects a signature made with the wrong secret', async () => {
    seedPendingPayment();
    const webhook = await loadWebhook();
    const rawBody = JSON.stringify(paymentEvent('payment.captured'));

    const res = await webhook(
      deliver(null, { rawBody, signature: sign(rawBody, 'not-the-real-secret') }),
    );

    expect(res.status).toBe(400);
    expect(invoiceRow().status).toBe('ISSUED');
  });

  it('covers the RAW bytes: a re-serialised body fails verification', async () => {
    seedPendingPayment();
    const webhook = await loadWebhook();
    const original = JSON.stringify(paymentEvent('payment.captured'));
    const reserialised = JSON.stringify(JSON.parse(original), null, 2);

    const res = await webhook(
      deliver(null, { rawBody: reserialised, signature: sign(original) }),
    );

    expect(res.status).toBe(400);
    expect(invoiceRow().status).toBe('ISSUED');
  });

  it('refuses a delivery without an event id, because idempotency is impossible', async () => {
    seedPendingPayment();
    const webhook = await loadWebhook();

    const res = await webhook(deliver(paymentEvent('payment.captured'), { eventId: null }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'MISSING_EVENT_ID' } });
    expect(invoiceRow().status).toBe('ISSUED');
  });

  it('answers 503 when the gateway is not configured', async () => {
    seedPendingPayment();
    process.env.RAZORPAY_WEBHOOK_SECRET = '';
    const webhook = await loadWebhook();

    const res = await webhook(deliver(paymentEvent('payment.captured')));

    expect(res.status).toBe(503);
    expect(invoiceRow().status).toBe('ISSUED');
  });
});

// ---------------------------------------------------------------------------
// Idempotency and ordering
// ---------------------------------------------------------------------------

describe('webhook idempotency', () => {
  it('acknowledges a duplicate delivery without applying it twice', async () => {
    seedPendingPayment();
    const webhook = await loadWebhook();
    const payload = paymentEvent('payment.captured');

    const first = await webhook(deliver(payload, { eventId: 'evt_DUPLICATE' }));
    const second = await webhook(deliver(payload, { eventId: 'evt_DUPLICATE' }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ received: true, duplicate: true });
    expect(store.statusEvents()).toHaveLength(1);
    expect(store.notifications()).toHaveLength(1);
    expect(store.webhookEvents()).toHaveLength(1);
  });

  it('does not let a later payment.failed rewind a capture', async () => {
    seedPendingPayment();
    const webhook = await loadWebhook();

    await webhook(deliver(paymentEvent('payment.captured'), { eventId: 'evt_CAPTURED' }));
    const late = await webhook(
      deliver(
        paymentEvent('payment.failed', {
          status: 'failed',
          captured: false,
          error_code: 'BAD_REQUEST_ERROR',
        }),
        { eventId: 'evt_FAILED_LATE' },
      ),
    );

    expect(late.status).toBe(200);
    expect(paymentRow().status).toBe('CAPTURED');
    expect(invoiceRow().status).toBe('PAID');
  });

  it('applies a capture that arrives after a failed attempt', async () => {
    seedPendingPayment();
    const webhook = await loadWebhook();

    await webhook(
      deliver(
        paymentEvent('payment.failed', { status: 'failed', captured: false }),
        { eventId: 'evt_FAILED_FIRST' },
      ),
    );
    expect(paymentRow().status).toBe('FAILED');
    expect(invoiceRow().status).toBe('ISSUED');

    await webhook(deliver(paymentEvent('payment.captured'), { eventId: 'evt_CAPTURED_LATER' }));

    expect(paymentRow().status).toBe('CAPTURED');
    expect(invoiceRow().status).toBe('PAID');
    expect(store.statusEvents()).toHaveLength(1);
  });

  it('records an AUTHORIZED delivery without paying the invoice', async () => {
    seedPendingPayment();
    const webhook = await loadWebhook();

    await webhook(
      deliver(paymentEvent('payment.authorized', { status: 'authorized', captured: false }), {
        eventId: 'evt_AUTHORIZED',
      }),
    );

    expect(paymentRow().status).toBe('AUTHORIZED');
    expect(invoiceRow().status).toBe('ISSUED');
  });
});

// ---------------------------------------------------------------------------
// Rejected and unknown events
// ---------------------------------------------------------------------------

describe('webhook rejects or ignores what it cannot trust', () => {
  it('rejects an amount mismatch and releases the claim for a later retry', async () => {
    seedPendingPayment();
    const webhook = await loadWebhook();

    const res = await webhook(
      deliver(paymentEvent('payment.captured', { amount: 1 }), { eventId: 'evt_WRONG_AMOUNT' }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'AMOUNT_MISMATCH' } });
    expect(invoiceRow().status).toBe('ISSUED');
    expect(paymentRow().status).toBe('PENDING');
    // The claim is released, so the provider's retry is processed rather than
    // mistaken for a duplicate.
    expect(store.webhookEvents()).toHaveLength(0);
  });

  it('ignores an unknown event type without touching a financial record', async () => {
    seedPendingPayment();
    const webhook = await loadWebhook();

    const res = await webhook(
      deliver({ event: 'order.paid', payload: {} }, { eventId: 'evt_UNKNOWN_TYPE' }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, ignored: 'unknown_event' });
    expect(invoiceRow().status).toBe('ISSUED');
    expect(paymentRow().status).toBe('PENDING');
  });

  it('ignores a payment it does not know, and still acknowledges the delivery', async () => {
    seedPendingPayment();
    const webhook = await loadWebhook();

    const res = await webhook(
      deliver(
        paymentEvent('payment.captured', {
          id: 'pay_UNKNOWN0001',
          order_id: 'order_UNKNOWN0001',
        }),
        { eventId: 'evt_UNKNOWN_PAYMENT' },
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: 'unknown_payment' });
    expect(invoiceRow().status).toBe('ISSUED');
    expect(store.webhookEvents()).toHaveLength(1);
  });

  it('rolls back a failed transaction, releases the claim and succeeds on retry', async () => {
    seedPendingPayment();
    const webhook = await loadWebhook();

    store.failNextInvoiceUpdate();
    const failed = await webhook(
      deliver(paymentEvent('payment.captured'), { eventId: 'evt_ROLLBACK' }),
    );

    expect(failed.status).toBe(500);
    // Nothing was committed: the payment did not move to CAPTURED.
    expect(paymentRow().status).toBe('PENDING');
    expect(invoiceRow().status).toBe('ISSUED');
    expect(store.webhookEvents()).toHaveLength(0);

    const retried = await webhook(
      deliver(paymentEvent('payment.captured'), { eventId: 'evt_ROLLBACK' }),
    );

    expect(retried.status).toBe(200);
    expect(paymentRow().status).toBe('CAPTURED');
    expect(invoiceRow().status).toBe('PAID');
  });
});

// ---------------------------------------------------------------------------
// Refunds (read-only)
// ---------------------------------------------------------------------------

describe('webhook refund state', () => {
  async function settleFirst(): Promise<void> {
    seedPendingPayment();
    const webhook = await loadWebhook();
    await webhook(deliver(paymentEvent('payment.captured'), { eventId: 'evt_CAPTURED' }));
    expect(invoiceRow().status).toBe('PAID');
  }

  it('records a full refund without rewriting the invoice', async () => {
    await settleFirst();
    const webhook = await loadWebhook();

    const res = await webhook(
      deliver(refundEvent({}, { includePayment: true, amountRefunded: 149_900 }), {
        eventId: 'evt_REFUND_FULL',
      }),
    );

    expect(res.status).toBe(200);
    expect(paymentRow()).toMatchObject({
      status: 'REFUNDED',
      refundedPaise: 149_900,
      refundStatus: 'PROCESSED',
    });
    // The invoice stays a paid document with its original total.
    expect(invoiceRow().status).toBe('PAID');
    expect(invoiceRow().totalPaise).toBe(149_900);
  });

  it('records a partial refund as PARTIALLY_REFUNDED', async () => {
    await settleFirst();
    const webhook = await loadWebhook();

    await webhook(
      deliver(
        refundEvent({ amount: 50_000 }, { includePayment: true, amountRefunded: 50_000 }),
        { eventId: 'evt_REFUND_PARTIAL' },
      ),
    );

    expect(paymentRow()).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      refundedPaise: 50_000,
    });
    expect(invoiceRow().status).toBe('PAID');
  });

  it('never exceeds the captured amount', async () => {
    await settleFirst();
    const webhook = await loadWebhook();

    await webhook(
      deliver(
        refundEvent({ amount: 999_999 }, { includePayment: true, amountRefunded: 999_999 }),
        { eventId: 'evt_REFUND_TOO_MUCH' },
      ),
    );

    expect(paymentRow().refundedPaise).toBe(149_900);
    expect(paymentRow().status).toBe('REFUNDED');
  });

  it('ignores a refund for a payment that was never captured', async () => {
    seedPendingPayment();
    const webhook = await loadWebhook();

    const res = await webhook(
      deliver(refundEvent(), { eventId: 'evt_REFUND_EARLY' }),
    );

    expect(res.status).toBe(200);
    expect(paymentRow().status).toBe('PENDING');
    expect(paymentRow().refundedPaise).toBe(0);
  });
});
