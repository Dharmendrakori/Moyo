import { ApiError, apiHandler, jsonOk, parseJson, tooManyRequests } from '@/lib/api';
import { adminWriteGuard, readIdParam } from '@/lib/admin-api';
import { INVOICE_POLICY, rateLimitByUser } from '@/lib/rate-limit';
import { adminGenerateInvoiceSchema } from '@/lib/validation';
import { generateInvoiceForBooking } from '@/lib/invoice';

/**
 * POST /api/admin/bookings/:id/invoice
 *
 * ISSUES an invoice for a completed booking.
 *
 * GUARD CHAIN: `adminWriteGuard` runs assertSameOrigin -> requireAdmin ->
 * assertCsrf -> general admin rate limit BEFORE the body is parsed, so an
 * unauthorized or cross-site caller never reaches this logic at all. The invoice
 * quota is then applied on top, because issuing a financial document is more
 * sensitive than an ordinary change.
 *
 * NO FINANCIAL INPUT IS ACCEPTED. The body schema is `z.object({}).strict()`, so
 * a request that tries to supply a price, an amount, a tax rate or a line item is
 * rejected outright. Every figure is resolved from the persisted booking inside
 * `generateInvoiceForBooking`, which also re-validates eligibility and does the
 * write transactionally - so a repeated or concurrent request cannot produce a
 * second invoice for the same booking.
 */
export const POST = apiHandler(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const guard = await adminWriteGuard(request);
    if (!guard.ok) return guard.response;

    const limit = await rateLimitByUser(INVOICE_POLICY, guard.user.id);
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

    const id = await readIdParam(context.params);
    await parseJson(request, adminGenerateInvoiceSchema);

    const invoice = await generateInvoiceForBooking(id, guard.user.id);
    if (!invoice) {
      throw new ApiError('NOT_FOUND', 'Booking not found', 404);
    }

    return jsonOk({ invoice }, { status: 201 });
  },
);
