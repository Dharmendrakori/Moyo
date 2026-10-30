import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { env } from '@/lib/env';
import type { GatewayOrder, GatewayPayment, PaymentProvider } from './provider';

/**
 * RAZORPAY PROVIDER
 *
 * The ONLY module in this application that knows Razorpay's API shapes. It uses
 * the documented REST API over `fetch` rather than pulling in the SDK: the whole
 * surface used here is one order POST, one payment GET and two HMAC
 * comparisons, and a dependency for that would be supply-chain cost with no
 * benefit. The signing rules below are taken from the official documentation and
 * the official Node SDK's own implementation, not invented:
 *
 *  - Checkout signature: HMAC-SHA256(`${order_id}|${payment_id}`, key_secret), hex.
 *    https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/
 *  - Webhook signature: HMAC-SHA256(raw_body, webhook_secret), hex, sent as
 *    `X-Razorpay-Signature`. https://razorpay.com/docs/webhooks/validate-test/
 *  - Orders: POST https://api.razorpay.com/v1/orders, HTTP Basic auth.
 *    https://razorpay.com/docs/api/orders/create/
 *
 * NOTHING HERE LOGS. A failed call throws a message containing at most an HTTP
 * status - never the key, the signature, the body or the response.
 */

const API_BASE = 'https://api.razorpay.com/v1';

/** Gateway ids are opaque but prefixed; anything else is refused before use. */
const ORDER_ID = /^order_[A-Za-z0-9]{6,64}$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9]{6,64}$/;

const orderSchema = z.object({
  id: z.string().min(1).max(80),
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
  status: z.string().min(1).max(20),
});

const paymentSchema = z.object({
  id: z.string().min(1).max(80),
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
  status: z.string().min(1).max(20),
  order_id: z.string().max(80).nullish(),
  captured: z.boolean().optional(),
  amount_refunded: z.number().int().nonnegative().optional(),
  refund_status: z.string().max(20).nullish(),
  error_code: z.string().max(80).nullish(),
  error_description: z.string().max(200).nullish(),
});

function hmacHex(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

/** Constant-time hex comparison. Length is compared first, as the API requires. */
function safeEqualHex(expected: string, provided: string): boolean {
  if (!provided || provided.length !== expected.length) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export class RazorpayProvider implements PaymentProvider {
  readonly name = 'RAZORPAY' as const;

  private credentials(): { keyId: string; keySecret: string } {
    const e = env();
    if (!e.RAZORPAY_KEY_ID || !e.RAZORPAY_KEY_SECRET) {
      throw new ApiError('NOT_CONFIGURED', 'Payment processing is not configured', 503);
    }
    return { keyId: e.RAZORPAY_KEY_ID, keySecret: e.RAZORPAY_KEY_SECRET };
  }

  private async request(path: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
    const { keyId, keySecret } = this.credentials();
    // HTTP Basic over TLS. The secret never appears in a URL or a log line.
    const auth = Buffer.from(`${keyId}:${keySecret}`, 'utf8').toString('base64');

    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method: init?.method ?? 'GET',
        headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/json' },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        cache: 'no-store',
      });
    } catch {
      throw new ApiError(
        'GATEWAY_UNAVAILABLE',
        'The payment gateway could not be reached. Please try again.',
        502,
      );
    }

    if (!res.ok) {
      // The gateway body can echo request fields, so only the status is kept.
      throw new ApiError(
        'GATEWAY_ERROR',
        `The payment gateway rejected this request (${res.status}).`,
        502,
      );
    }

    try {
      return await res.json();
    } catch {
      throw new ApiError(
        'GATEWAY_ERROR',
        'The payment gateway returned an unreadable response.',
        502,
      );
    }
  }

  async createOrder(input: {
    amountPaise: number;
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<GatewayOrder> {
    // Money is integer paise; a float here would silently misprice the charge.
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new ApiError('INVALID_AMOUNT', 'The invoice amount is not chargeable', 422);
    }

    const raw = await this.request('/orders', {
      method: 'POST',
      body: {
        amount: input.amountPaise,
        currency: input.currency,
        // Razorpay caps receipt at 40 characters.
        receipt: input.receipt.slice(0, 40),
        notes: input.notes,
        // Partial payment is off: an invoice is paid in full or not at all.
        partial_payment: false,
      },
    });

    const parsed = orderSchema.safeParse(raw);
    if (!parsed.success || !ORDER_ID.test(parsed.data.id)) {
      throw new ApiError('GATEWAY_ERROR', 'The payment gateway returned an unexpected order.', 502);
    }

    return {
      orderId: parsed.data.id,
      amountPaise: parsed.data.amount,
      currency: parsed.data.currency,
    };
  }

  async fetchPayment(paymentId: string): Promise<GatewayPayment> {
    if (!PAYMENT_ID.test(paymentId)) {
      throw new ApiError('INVALID_PAYMENT_ID', 'Invalid payment reference', 400);
    }

    const raw = await this.request(`/payments/${paymentId}`);
    const parsed = paymentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiError(
        'GATEWAY_ERROR',
        'The payment gateway returned an unexpected payment.',
        502,
      );
    }

    const p = parsed.data;
    return {
      paymentId: p.id,
      orderId: p.order_id ?? null,
      status: p.status,
      captured: p.captured === true || p.status === 'captured',
      amountPaise: p.amount,
      currency: p.currency,
      amountRefundedPaise: p.amount_refunded ?? 0,
      refundStatus: p.refund_status ?? null,
      errorCode: p.error_code ?? null,
      errorDescription: p.error_description ?? null,
    };
  }

  /**
   * Verifies the signature the checkout hands back to the browser.
   *
   * This proves the (order, payment) pair was issued by Razorpay for our
   * account. It does NOT prove the money was captured - the caller must still
   * fetch the payment and read its status.
   */
  verifyCheckoutSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean {
    const { keySecret } = this.credentials();
    const expected = hmacHex(`${input.orderId}|${input.paymentId}`, keySecret);
    return safeEqualHex(expected, input.signature);
  }

  /**
   * Verifies a webhook delivery.
   *
   * `rawBody` must be the exact request body: re-serialising parsed JSON does
   * not reproduce the signed bytes.
   */
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    const secret = env().RAZORPAY_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    return safeEqualHex(hmacHex(rawBody, secret), signature.trim());
  }
}
