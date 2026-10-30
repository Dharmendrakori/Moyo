import { apiHandler, notFound, pdfResponse, tooManyRequests } from '@/lib/api';
import { assertSameOrigin, requireUser } from '@/lib/auth';
import { INVOICE_POLICY, rateLimitByUser } from '@/lib/rate-limit';
import { getInvoiceForCustomer, toInvoicePdfDocument } from '@/lib/invoice';
import { renderInvoicePdf } from '@/lib/invoice-pdf';

/**
 * GET /api/bookings/:id/invoice/pdf
 *
 * A CUSTOMER downloads the invoice for one of their own bookings.
 *
 * AUTHORIZATION. The customer id comes from the session, never from the request,
 * and it is part of the query (`getInvoiceForCustomer` matches on `bookingId`
 * AND `customerId`). A foreign booking or invoice is therefore never loaded, and
 * answers exactly the same 404 as one that does not exist - so this URL cannot be
 * used to probe which invoice ids are real.
 *
 * A missing session is a 401 before any lookup happens, a malformed id is a 404,
 * and the request is rate-limited per account.
 */
export const GET = apiHandler(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    assertSameOrigin(request);

    const user = await requireUser();

    const limit = await rateLimitByUser(INVOICE_POLICY, user.id);
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

    const { id } = await context.params;
    // Rejecting a malformed id here keeps the "not found" answer identical to the
    // one for a real-but-foreign record.
    if (typeof id !== 'string' || !/^c[a-z0-9]{20,30}$/.test(id)) {
      throw notFound('Invoice');
    }

    const invoice = await getInvoiceForCustomer(user.id, id);
    if (!invoice) {
      throw notFound('Invoice');
    }

    return pdfResponse(invoice.number, renderInvoicePdf(toInvoicePdfDocument(invoice)));
  },
);
