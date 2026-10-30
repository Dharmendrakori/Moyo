import { ApiError, apiHandler, jsonOk, notFound, parseJson, tooManyRequests } from '@/lib/api';
import { assertCsrf, assertSameOrigin, requireUser } from '@/lib/auth';
import { isPaymentConfigured } from '@/lib/env';
import { startInvoicePayment } from '@/lib/payments/ledger';
import { PAYMENT_POLICY, rateLimitByUser } from '@/lib/rate-limit';
import { paymentInitiateSchema } from '@/lib/validation';

/**
 * POST /api/bookings/:id/payment
 *
 * Starts (or resumes) the online payment for one of the CUSTOMER'S OWN issued
 * invoices.
 *
 * WHAT THE SERVER DECIDES, NOT THE BROWSER:
 *  - who the customer is (session),
 *  - that the invoice belongs to them (`customerId` is in the query),
 *  - that the invoice is payable,
 *  - the amount and currency (read from the persisted invoice).
 *
 * The identity of the invoice is the route parameter, and the invoice is looked
 * up BY OWNERSHIP, so a foreign booking answers the same 404 as one that does
 * not exist.
 *
 * The request body must be empty JSON: `.strict()` rejects any attempt to send
 * an amount, currency or invoice id. CSRF is verified because this creates a
 * chargeable gateway order on behalf of the session.
 *
 * The response contains only what checkout needs - the publishable key id, the
 * order id, the amount and the invoice number. No secret is ever returned.
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
    // A malformed id never becomes a database lookup.
    if (typeof id !== 'string' || !CUID.test(id)) throw notFound('Invoice');

    // No field is accepted; anything extra rejects the request outright.
    await parseJson(request, paymentInitiateSchema);

    const started = await startInvoicePayment(user.id, id);

    return jsonOk({
      keyId: started.keyId,
      orderId: started.orderId,
      amountPaise: started.amountPaise,
      currency: started.currency,
      invoiceNumber: started.invoiceNumber,
    });
  },
);
