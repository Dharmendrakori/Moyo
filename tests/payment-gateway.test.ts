/// <reference types="vitest/globals" />

/**
 * PAYMENT GATEWAY AND PAYABILITY UNIT TESTS
 *
 * No database and no route: this suite pins the two things that are easy to get
 * silently wrong and expensive to get wrong - the gateway's signing rules and
 * the rule that decides whether an invoice may be paid at all.
 */

import { createHmac } from 'node:crypto';
import { RazorpayProvider } from '../src/lib/payments/razorpay';
import {
  assessInvoicePayability,
  describePaymentState,
  paymentIdempotencyKey,
  paymentStatusLabel,
} from '../src/lib/payments/ledger';

const KEY_ID = 'rzp_test_keyid';
const KEY_SECRET = 'rzp_test_secret_value';
const WEBHOOK_SECRET = 'rzp_test_webhook_secret';
const ORDER_ID = 'order_TESTORDER0001';
const PAYMENT_ID = 'pay_TESTPAYMENT0001';

beforeAll(() => {
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const hmac = (message: string, secret: string) =>
  createHmac('sha256', secret).update(message, 'utf8').digest('hex');

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

describe('checkout signature verification', () => {
  const provider = new RazorpayProvider();

  it('accepts the documented HMAC-SHA256(order|payment, key_secret) signature', () => {
    const signature = hmac(`${ORDER_ID}|${PAYMENT_ID}`, KEY_SECRET);
    expect(
      provider.verifyCheckoutSignature({ orderId: ORDER_ID, paymentId: PAYMENT_ID, signature }),
    ).toBe(true);
  });

  it('rejects a signature over a different order', () => {
    const signature = hmac(`order_OTHER00001|${PAYMENT_ID}`, KEY_SECRET);
    expect(
      provider.verifyCheckoutSignature({ orderId: ORDER_ID, paymentId: PAYMENT_ID, signature }),
    ).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const signature = hmac(`${ORDER_ID}|${PAYMENT_ID}`, 'some-other-secret');
    expect(
      provider.verifyCheckoutSignature({ orderId: ORDER_ID, paymentId: PAYMENT_ID, signature }),
    ).toBe(false);
  });

  it('rejects an empty or truncated signature without throwing', () => {
    const full = hmac(`${ORDER_ID}|${PAYMENT_ID}`, KEY_SECRET);
    for (const signature of ['', full.slice(0, 60), `${full}00`]) {
      expect(
        provider.verifyCheckoutSignature({ orderId: ORDER_ID, paymentId: PAYMENT_ID, signature }),
      ).toBe(false);
    }
  });
});

describe('webhook signature verification', () => {
  const provider = new RazorpayProvider();

  it('accepts HMAC-SHA256(rawBody, webhook_secret)', () => {
    const body = '{"event":"payment.captured"}';
    expect(provider.verifyWebhookSignature(body, hmac(body, WEBHOOK_SECRET))).toBe(true);
  });

  it('rejects a body that differs by one byte', () => {
    const body = '{"event":"payment.captured"}';
    const signature = hmac(body, WEBHOOK_SECRET);
    expect(provider.verifyWebhookSignature(`${body} `, signature)).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(provider.verifyWebhookSignature('{}', null)).toBe(false);
    expect(provider.verifyWebhookSignature('{}', '')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gateway HTTP surface
// ---------------------------------------------------------------------------

function stubGateway(response: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return calls;
}

describe('order creation', () => {
  it('posts integer paise with Basic auth and no partial payment', async () => {
    const calls = stubGateway({
      id: ORDER_ID,
      entity: 'order',
      amount: 149_900,
      currency: 'INR',
      status: 'created',
    });

    const order = await new RazorpayProvider().createOrder({
      amountPaise: 149_900,
      currency: 'INR',
      receipt: 'SERIC-INV-2026-000001',
      notes: { invoiceNumber: 'SERIC-INV-2026-000001' },
    });

    expect(order).toEqual({ orderId: ORDER_ID, amountPaise: 149_900, currency: 'INR' });

    const [call] = calls;
    expect(call.url).toBe('https://api.razorpay.com/v1/orders');
    expect(call.init.method).toBe('POST');
    expect((call.init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`,
    );
    expect(JSON.parse(String(call.init.body))).toMatchObject({
      amount: 149_900,
      currency: 'INR',
      partial_payment: false,
    });
  });

  it('refuses a non-integer or non-positive amount before calling the gateway', async () => {
    const calls = stubGateway({});

    await expect(
      new RazorpayProvider().createOrder({ amountPaise: 12.5, currency: 'INR', receipt: 'x' }),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    await expect(
      new RazorpayProvider().createOrder({ amountPaise: 0, currency: 'INR', receipt: 'x' }),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    expect(calls).toHaveLength(0);
  });

  it('reports a gateway rejection as a safe, secret-free error', async () => {
    stubGateway({ error: { description: 'internal detail that must not leak' } }, 400);

    const error = await new RazorpayProvider()
      .createOrder({ amountPaise: 100, currency: 'INR', receipt: 'x' })
      .catch((err: unknown) => err as Error & { code?: string; status?: number });

    expect(error).toMatchObject({ code: 'GATEWAY_ERROR', status: 502 });
    expect(error.message).not.toContain('internal detail');
    expect(error.message).not.toContain(KEY_SECRET);
  });
});

describe('payment retrieval', () => {
  it('maps the documented payment entity to a minimal projection', async () => {
    stubGateway({
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
      card: { last4: '4242' },
    });

    const payment = await new RazorpayProvider().fetchPayment(PAYMENT_ID);

    expect(payment).toEqual({
      paymentId: PAYMENT_ID,
      orderId: ORDER_ID,
      status: 'captured',
      captured: true,
      amountPaise: 149_900,
      currency: 'INR',
      amountRefundedPaise: 0,
      refundStatus: null,
      errorCode: null,
      errorDescription: null,
    });
    // Card data is not part of the projection, so it cannot be stored or logged.
    expect(JSON.stringify(payment)).not.toContain('4242');
  });

  it('refuses to build a request URL from a non-gateway id', async () => {
    const calls = stubGateway({});

    await expect(new RazorpayProvider().fetchPayment('../../v1/orders')).rejects.toMatchObject({
      code: 'INVALID_PAYMENT_ID',
    });
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Payability rules
// ---------------------------------------------------------------------------

describe('assessInvoicePayability', () => {
  const invoice = { status: 'ISSUED', totalPaise: 149_900, currency: 'INR' };

  it('accepts an issued INR invoice with a positive amount', () => {
    expect(assessInvoicePayability(invoice)).toEqual({ payable: true });
    expect(assessInvoicePayability({ ...invoice, status: 'OVERDUE' })).toEqual({ payable: true });
  });

  it('refuses a paid, void or unissued invoice', () => {
    expect(assessInvoicePayability({ ...invoice, status: 'PAID' })).toMatchObject({
      payable: false,
      code: 'ALREADY_PAID',
    });
    expect(assessInvoicePayability({ ...invoice, status: 'VOID' })).toMatchObject({
      payable: false,
      code: 'VOID',
    });
    for (const status of ['DRAFT', 'SOMETHING_ELSE']) {
      expect(assessInvoicePayability({ ...invoice, status })).toMatchObject({
        payable: false,
        code: 'NOT_ISSUED',
      });
    }
  });

  it('refuses a non-positive or non-integer total', () => {
    expect(assessInvoicePayability({ ...invoice, totalPaise: 0 })).toMatchObject({
      code: 'INVALID_AMOUNT',
    });
    expect(assessInvoicePayability({ ...invoice, totalPaise: 10.5 })).toMatchObject({
      code: 'INVALID_AMOUNT',
    });
  });

  it('refuses a currency the gateway account cannot charge', () => {
    expect(assessInvoicePayability({ ...invoice, currency: 'USD' })).toMatchObject({
      code: 'UNSUPPORTED_CURRENCY',
    });
  });
});

describe('describePaymentState', () => {
  const base = { invoiceStatus: 'ISSUED', totalPaise: 149_900, currency: 'INR' };

  it('offers payment when nothing has been attempted', () => {
    expect(describePaymentState({ ...base, attempt: null })).toMatchObject({
      state: 'NOT_STARTED',
      canPay: true,
    });
  });

  it('offers a retry after a failure and does not claim a charge', () => {
    const view = describePaymentState({
      ...base,
      attempt: { status: 'FAILED', refundStatus: null, refundedPaise: 0 },
    });
    expect(view).toMatchObject({ state: 'FAILED', canPay: true });
    expect(view.note).toContain('Nothing was charged');
  });

  it('treats an authorized payment as processing, not paid', () => {
    expect(
      describePaymentState({
        ...base,
        attempt: { status: 'AUTHORIZED', refundStatus: null, refundedPaise: 0 },
      }),
    ).toMatchObject({ state: 'PROCESSING', canPay: false });
  });

  it('reports a captured payment as paid and stops offering checkout', () => {
    expect(
      describePaymentState({
        ...base,
        invoiceStatus: 'PAID',
        attempt: { status: 'CAPTURED', refundStatus: null, refundedPaise: 0 },
      }),
    ).toMatchObject({ state: 'PAID', canPay: false });
  });

  it('reports refunds separately from the invoice state', () => {
    expect(
      describePaymentState({
        ...base,
        invoiceStatus: 'PAID',
        attempt: { status: 'REFUNDED', refundStatus: 'PROCESSED', refundedPaise: 149_900 },
      }),
    ).toMatchObject({ state: 'REFUNDED', canPay: false });

    expect(
      describePaymentState({
        ...base,
        invoiceStatus: 'PAID',
        attempt: { status: 'CAPTURED', refundStatus: 'PENDING', refundedPaise: 149_900 },
      }),
    ).toMatchObject({ state: 'REFUND_PENDING', canPay: false });
  });

  it('never offers payment for an invoice that is no longer payable', () => {
    expect(
      describePaymentState({
        ...base,
        invoiceStatus: 'VOID',
        attempt: { status: 'FAILED', refundStatus: null, refundedPaise: 0 },
      }),
    ).toMatchObject({ state: 'FAILED', canPay: false });
  });
});

describe('payment identity helpers', () => {
  it('keys one attempt per invoice', () => {
    expect(paymentIdempotencyKey('cinvoice00000000000000001')).toBe(
      'invoice:cinvoice00000000000000001',
    );
  });

  it('labels a stored status, falling back to the raw value', () => {
    expect(paymentStatusLabel('CAPTURED')).toBe('Paid');
    expect(paymentStatusLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});

// ---------------------------------------------------------------------------
// Unconfigured gateway
// ---------------------------------------------------------------------------

describe('unconfigured gateway', () => {
  it('refuses to sign or call out without credentials', async () => {
    process.env.RAZORPAY_KEY_SECRET = '';
    vi.resetModules();
    const { RazorpayProvider: FreshProvider } = await import('../src/lib/payments/razorpay');
    const calls = stubGateway({});

    await expect(
      new FreshProvider().createOrder({ amountPaise: 100, currency: 'INR', receipt: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED', status: 503 });
    expect(calls).toHaveLength(0);

    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  });
});
