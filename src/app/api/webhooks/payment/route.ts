import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { env, isPaymentConfigured } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { apiHandler } from '@/lib/api';
import { WEBHOOK_POLICY, rateLimitByIp } from '@/lib/rate-limit';

/**
 * POST /api/webhooks/payment
 *
 * The ONLY path by which a booking can become PAID.
 *
 * Security requirements enforced here:
 *  - HMAC-SHA256 signature verification over the RAW request body, compared in
 *    constant time. The body is read as text BEFORE JSON parsing, because
 *    re-serializing parsed JSON does not reproduce the signed bytes.
 *  - Signature lives in a header, never in the payload.
 *  - Idempotent: the provider event id is unique, so an aggressive provider
 *    retry cannot double-apply a settlement.
 *  - The amount is checked against the stored invoice total; a mismatch is
 *    rejected rather than silently accepted.
 *  - No card data is read or stored - only an opaque provider reference and an
 *    optional masked last-4.
 *
 * When no payment provider is configured this returns 503 rather than
 * pretending to process money.
 */

const webhookSchema = z.object({
  /** Unique event id from the provider, used for idempotency. */
  eventId: z.string().min(1).max(120),
  type: z.enum(['payment.succeeded', 'payment.failed', 'payment.refunded']),
  paymentId: z.string().min(1).max(120),
  idempotencyKey: z.string().min(8).max(120),
  invoiceId: z.string().min(1).max(40),
  amountPaise: z.number().int().positive(),
  currency: z.string().length(3),
  /** Optional masked card digits, e.g. "**** 4242". */
  cardLast4: z.string().regex(/^\*?\*{0,4}\d{0,4}$/).optional(),
});

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = env().PAYMENT_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!signatureHeader) return false;

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  // Provider may prefix the algorithm, e.g. "sha256=<hex>".
  const provided = signatureHeader.includes('=')
    ? signatureHeader.slice(signatureHeader.indexOf('=') + 1).trim()
    : signatureHeader.trim();

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const POST = apiHandler(async (request: Request) => {
  if (!isPaymentConfigured()) {
    return NextResponse.json(
      { error: { code: 'NOT_CONFIGURED', message: 'Payment processing is not configured' } },
      { status: 503 },
    );
  }

  const limit = await rateLimitByIp(WEBHOOK_POLICY);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  // Read the RAW body first - the signature covers the exact bytes.
  const rawBody = await request.text();
  if (rawBody.length > 64 * 1024) {
    return NextResponse.json(
      { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' } },
      { status: 413 },
    );
  }

  const signature = request.headers.get('x-moyo-signature') ?? request.headers.get('x-signature');
  if (!verifySignature(rawBody, signature)) {
    await audit({
      action: 'ACCESS_DENIED',
      entityType: 'PaymentWebhook',
      metadata: { reason: 'invalid_signature' },
    });
    // 401: the caller cannot prove it is the payment provider.
    return NextResponse.json(
      { error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' } },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Malformed payload' } },
      { status: 400 },
    );
  }

  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid webhook payload' } },
      { status: 422 },
    );
  }

  const event = parsed.data;

  // Idempotency: if this event id was already processed, acknowledge and stop.
  const alreadyApplied = await prisma.auditLog.findFirst({
    where: { action: 'PAYMENT_STATUS_CHANGED', entityId: event.eventId },
    select: { id: true },
  });
  if (alreadyApplied) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: event.invoiceId },
    select: {
      id: true,
      number: true,
      status: true,
      totalPaise: true,
      currency: true,
      bookingId: true,
    },
  });

  if (!invoice) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Unknown invoice' } },
      { status: 404 },
    );
  }

  // Never trust the amount the provider echoes back without checking it.
  if (
    event.amountPaise !== invoice.totalPaise ||
    event.currency.toUpperCase() !== invoice.currency.toUpperCase()
  ) {
    await audit({
      action: 'ACCESS_DENIED',
      entityType: 'Invoice',
      entityId: invoice.id,
      metadata: { reason: 'amount_mismatch', eventId: event.eventId },
    });
    return NextResponse.json(
      { error: { code: 'AMOUNT_MISMATCH', message: 'Payment amount does not match the invoice' } },
      { status: 409 },
    );
  }

  const paymentStatus =
    event.type === 'payment.succeeded'
      ? 'SUCCEEDED'
      : event.type === 'payment.failed'
        ? 'FAILED'
        : 'REFUNDED';

  await prisma.$transaction(async (tx) => {
    await tx.payment.upsert({
      where: { idempotencyKey: event.idempotencyKey },
      update: {
        status: paymentStatus,
        providerRef: event.paymentId,
        signatureVerified: true,
        cardLast4: event.cardLast4 ?? null,
      },
      create: {
        idempotencyKey: event.idempotencyKey,
        invoiceId: invoice.id,
        bookingId: invoice.bookingId,
        status: paymentStatus,
        amountPaise: event.amountPaise,
        currency: event.currency.toUpperCase(),
        providerRef: event.paymentId,
        signatureVerified: true,
        cardLast4: event.cardLast4 ?? null,
      },
    });

    if (paymentStatus === 'SUCCEEDED') {
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID', paidAt: new Date() },
      });

      // Advance the booking only along the legal edge PAYMENT_PENDING -> PAID.
      const booking = await tx.booking.findUnique({
        where: { id: invoice.bookingId },
        select: { id: true, status: true, customerId: true },
      });

      if (booking && booking.status === 'PAYMENT_PENDING') {
        await tx.booking.update({
          where: { id: booking.id },
          data: { status: 'PAID' },
        });
        await tx.bookingStatusEvent.create({
          data: {
            bookingId: booking.id,
            from: 'PAYMENT_PENDING',
            to: 'PAID',
            // No actor: the payment provider is the actor, not a user.
            actorId: null,
            actorRole: null,
            note: 'Settled by verified payment webhook',
          },
        });
        await tx.notification.create({
          data: {
            userId: booking.customerId,
            channel: 'IN_APP',
            title: 'Payment received',
            body: `Payment for invoice ${invoice.number} is confirmed.`,
            link: `/bookings/${booking.id}`,
            status: 'SENT',
          },
        });
      }
    }
  });

  await audit({
    action: 'PAYMENT_STATUS_CHANGED',
    entityType: 'Payment',
    // entityId doubles as the provider event id, giving us idempotency.
    entityId: event.eventId,
    metadata: { invoiceId: invoice.id, paymentStatus, signatureVerified: true },
  });

  return NextResponse.json({ received: true });
});