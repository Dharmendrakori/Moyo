import { ApiError, apiHandler, jsonOk, notFound, parseJson, tooManyRequests } from '@/lib/api';
import { audit } from '@/lib/audit';
import { assertCsrf, assertSameOrigin, requireUser } from '@/lib/auth';
import { isPaymentConfigured } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { findAttemptByOrder, settleFromGateway } from '@/lib/payments/ledger';
import { getPaymentProvider } from '@/lib/payments/provider';
import { PAYMENT_POLICY, rateLimitByUser } from '@/lib/rate-limit';
import { paymentVerifySchema } from '@/lib/validation';

/**
 * POST /api/bookings/:id/payment/verify
 *
 * The checkout callback. THIS IS NOT PROOF OF PAYMENT.
 *
 * Three independent checks must all pass before the invoice can change:
 *
 *  1. the gateway's documented HMAC-SHA256 signature over
 *     `order_id|payment_id` recomputes correctly with our key secret;
 *  2. the order is one this application issued, for THIS customer's invoice;
 *  3. the payment fetched from the gateway is genuinely `captured`, with the
 *     same order, amount and currency.
 *
 * Only then is the ledger updated - and the ledger's own conditional updates
 * make a repeated or concurrent callback a no-op rather than a second payment.
 *
 * A rejected verification NEVER moves the invoice. It writes an audit entry and
 * returns an error the browser can show.
 */
const CUID = /^c[a-z0-9]{20,30}$/;

export const POST = apiHandler(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    assertSameOrigin(request);

    const user = await requireUser();
    await assertCsrf(request);

    const limit = await rateLimitByUser(PAYMENT_POLICY, user.id);
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

    if (!isPaymentConfigured()) {
      throw new ApiError('NOT_CONFIGURED', 'Online payment is not available right now.', 503);
    }

    const { id } = await context.params;
    if (typeof id !== 'string' || !CUID.test(id)) throw notFound('Invoice');

    const body = await parseJson(request, paymentVerifySchema);

    // Ownership is part of the query, so a foreign invoice is never loaded.
    const invoice = await prisma.invoice.findFirst({
      where: { bookingId: id, customerId: user.id },
      select: {
        id: true,
        number: true,
        bookingId: true,
        status: true,
        totalPaise: true,
        currency: true,
      },
    });
    if (!invoice) throw notFound('Invoice');

    const attempt = await findAttemptByOrder(body.razorpay_order_id);
    // Unknown order and someone else's order are the same answer.
    if (!attempt || attempt.invoiceId !== invoice.id) throw notFound('Payment');

    const provider = getPaymentProvider();

    if (
      !provider.verifyCheckoutSignature({
        orderId: body.razorpay_order_id,
        paymentId: body.razorpay_payment_id,
        signature: body.razorpay_signature,
      })
    ) {
      await audit({
        action: 'PAYMENT_VERIFICATION_FAILED',
        entityType: 'Payment',
        entityId: attempt.id,
        actorId: user.id,
        actorRole: 'CUSTOMER',
        metadata: { reason_code: 'INVALID_SIGNATURE', source: 'CHECKOUT' },
      });
      throw new ApiError('INVALID_SIGNATURE', 'This payment could not be verified.', 400);
    }

    // The signature proves the pair was issued to us; only the gateway can say
    // whether the money was actually captured.
    const gatewayPayment = await provider.fetchPayment(body.razorpay_payment_id);

    const outcome = await settleFromGateway({
      attempt,
      invoice,
      gatewayPayment,
      source: 'CHECKOUT',
      actorId: user.id,
    });

    return jsonOk({
      status: outcome.status,
      invoiceStatus: outcome.invoiceStatus,
      changed: outcome.changed,
    });
  },
);
