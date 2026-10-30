import { NextResponse } from 'next/server';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { apiHandler } from '@/lib/api';
import { isPaymentConfigured } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import {
  applyRefundStatus,
  findAttemptByGatewayPayment,
  findAttemptByOrder,
  isUniqueViolation,
  settleFromGateway,
} from '@/lib/payments/ledger';
import { getPaymentProvider, type GatewayPayment } from '@/lib/payments/provider';
import { WEBHOOK_POLICY, rateLimitByIp } from '@/lib/rate-limit';

/**
 * POST /api/webhooks/payment
 *
 * Razorpay's notification endpoint - the authoritative, asynchronous path that
 * settles a payment even if the customer closes the browser tab.
 *
 * SECURITY MODEL (deliberately NOT CSRF):
 * A webhook is a server-to-server call with no cookie and no session, so CSRF
 * tokens and same-origin checks are meaningless here and are not applied. The
 * control is the gateway's own signature:
 *
 *  - the body is read as TEXT before parsing, because the signature covers the
 *    exact bytes and re-serialising JSON does not reproduce them;
 *  - `X-Razorpay-Signature` is HMAC-SHA256(raw_body, webhook_secret), compared
 *    in constant time;
 *  - an unsigned or wrongly-signed delivery is rejected with 400 and mutates
 *    nothing.
 *
 * IDEMPOTENCY. Razorpay delivers at least once, so `x-razorpay-event-id` is
 * recorded in a `@unique` column. A duplicate delivery returns 200 without
 * touching a financial record. If processing fails, the claim row is released
 * so the gateway's retry is processed rather than silently swallowed.
 *
 * FORWARD-ONLY STATE. The ledger's writes are conditional, so a late
 * `payment.failed` cannot rewind a capture and a replayed capture cannot pay an
 * invoice twice.
 */

const paymentEntitySchema = z.object({
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

const refundEntitySchema = z.object({
  id: z.string().min(1).max(80),
  payment_id: z.string().min(1).max(80),
  amount: z.number().int().nonnegative(),
  status: z.string().min(1).max(20),
});

const eventSchema = z.object({
  event: z.string().min(1).max(60),
  payload: z.object({
    payment: z.object({ entity: paymentEntitySchema }).optional(),
    refund: z.object({ entity: refundEntitySchema }).optional(),
  }),
});

type PaymentEntity = z.infer<typeof paymentEntitySchema>;

function toGatewayPayment(entity: PaymentEntity): GatewayPayment {
  return {
    paymentId: entity.id,
    orderId: entity.order_id ?? null,
    status: entity.status,
    captured: entity.captured === true || entity.status === 'captured',
    amountPaise: entity.amount,
    currency: entity.currency,
    amountRefundedPaise: entity.amount_refunded ?? 0,
    refundStatus: entity.refund_status ?? null,
    errorCode: entity.error_code ?? null,
    errorDescription: entity.error_description ?? null,
  };
}

const ok = (body: Record<string, unknown>) =>
  NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });

const bad = (code: string, message: string, status = 400) =>
  NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );

/** Resolves the attempt an event refers to, from identifiers the gateway signed. */
async function resolveAttempt(entity: { orderId: string | null; paymentId: string }) {
  // The order id is the strongest link: it is ours and unique.
  if (entity.orderId) {
    const byOrder = await findAttemptByOrder(entity.orderId);
    if (byOrder) return byOrder;
  }
  return findAttemptByGatewayPayment(entity.paymentId);
}

async function invoiceFor(attempt: { invoiceId: string }) {
  return prisma.invoice.findUnique({
    where: { id: attempt.invoiceId },
    select: {
      id: true,
      number: true,
      bookingId: true,
      status: true,
      totalPaise: true,
      currency: true,
    },
  });
}

/**
 * Applies one verified event.
 *
 * Unknown references and unknown event types are acknowledged with 200 so the
 * gateway stops retrying them - they change nothing. Everything that IS applied
 * goes through the ledger's conditional writes.
 */
async function processEvent(event: z.infer<typeof eventSchema>): Promise<{
  paymentId?: string;
  body: Record<string, unknown>;
}> {
  if (event.event.startsWith('payment.')) {
    const entity = event.payload.payment?.entity;
    if (!entity) return { body: { ignored: 'no_payment_entity' } };

    const attempt = await resolveAttempt({ orderId: entity.order_id ?? null, paymentId: entity.id });
    if (!attempt) return { body: { ignored: 'unknown_payment' } };

    const invoice = await invoiceFor(attempt);
    if (!invoice) return { body: { ignored: 'unknown_invoice' } };

    const outcome = await settleFromGateway({
      attempt,
      invoice,
      gatewayPayment: toGatewayPayment(entity),
      source: 'WEBHOOK',
    });

    return {
      paymentId: attempt.id,
      body: { paymentStatus: outcome.status, invoiceStatus: outcome.invoiceStatus },
    };
  }

  if (event.event.startsWith('refund.')) {
    const refund = event.payload.refund?.entity;
    if (!refund) return { body: { ignored: 'no_refund_entity' } };

    const attempt = await findAttemptByGatewayPayment(refund.payment_id);
    if (!attempt) return { body: { ignored: 'unknown_payment' } };

    // `amount_refunded` on the payment entity is the running total; a refund
    // entity alone only describes one refund. Prefer the total when present.
    // shortcut: without the payment entity we report the single refund amount,
    // which under-reports cumulative partial refunds. Upgrade when partial
    // refunds are approved as a business process.
    const paymentEntity = event.payload.payment?.entity;
    const refundedPaise = Math.max(
      paymentEntity?.amount_refunded ?? 0,
      refund.amount,
      paymentEntity?.amount_refunded === undefined ? attempt.refundedPaise : 0,
    );

    const changed = await applyRefundStatus(attempt.id, {
      refundedPaise,
      refundStatus: refund.status,
    });

    return { paymentId: attempt.id, body: { refund: changed ? 'recorded' : 'ignored' } };
  }

  // Unknown event type: acknowledged, never applied.
  return { body: { ignored: 'unknown_event' } };
}

export const POST = apiHandler(async (request: Request) => {
  if (!isPaymentConfigured()) {
    // Nothing to verify against, so nothing is trusted.
    return bad('NOT_CONFIGURED', 'Payment processing is not configured', 503);
  }

  const limit = await rateLimitByIp(WEBHOOK_POLICY);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  // RAW body first: the signature covers these exact bytes.
  const rawBody = await request.text();
  if (rawBody.length > 64 * 1024) {
    return bad('PAYLOAD_TOO_LARGE', 'Payload too large', 413);
  }

  const signature = request.headers.get('x-razorpay-signature');
  const eventId = request.headers.get('x-razorpay-event-id');

  if (!getPaymentProvider().verifyWebhookSignature(rawBody, signature)) {
    await audit({
      action: 'ACCESS_DENIED',
      entityType: 'PaymentWebhook',
      entityId: eventId,
      metadata: { reason: 'invalid_signature' },
    });
    return bad('INVALID_SIGNATURE', 'Invalid webhook signature');
  }

  // Only once the signature is proven may the body be parsed.
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return bad('INVALID_PAYLOAD', 'Invalid webhook payload');
  }

  const parsed = eventSchema.safeParse(parsedJson);
  if (!parsed.success) {
    await audit({
      action: 'ACCESS_DENIED',
      entityType: 'PaymentWebhook',
      entityId: eventId,
      metadata: { reason: 'invalid_payload' },
    });
    return bad('INVALID_PAYLOAD', 'Invalid webhook payload');
  }

  // Without the gateway's event id we cannot guarantee idempotency, so the
  // delivery is refused rather than processed blind to duplicates.
  if (!eventId) return bad('MISSING_EVENT_ID', 'Missing x-razorpay-event-id header');

  const event = parsed.data;

  // Claim the event. The unique index is the idempotency lock.
  try {
    await prisma.paymentWebhookEvent.create({ data: { eventId, type: event.event } });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Already processed: 200 so the gateway stops retrying.
      return ok({ received: true, duplicate: true });
    }
    throw err;
  }

  try {
    const result = await processEvent(event);
    if (result.paymentId) {
      await prisma.paymentWebhookEvent.updateMany({
        where: { eventId, paymentId: null },
        data: { paymentId: result.paymentId },
      });
    }
    return ok({ received: true, ...result.body });
  } catch (err) {
    // Release the claim so the gateway's retry is processed instead of being
    // mistaken for a duplicate. Re-throw so `apiHandler` logs it and returns 500,
    // which is what tells the gateway to retry.
    await prisma.paymentWebhookEvent.deleteMany({ where: { eventId } });
    throw err;
  }
});

