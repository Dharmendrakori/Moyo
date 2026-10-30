import { ApiError, apiHandler, pdfResponse, tooManyRequests } from '@/lib/api';
import { adminReadGuard, readIdParam } from '@/lib/admin-api';
import { INVOICE_POLICY, rateLimitByUser } from '@/lib/rate-limit';
import { getInvoiceById, toInvoicePdfDocument } from '@/lib/invoice';
import { renderInvoicePdf } from '@/lib/invoice-pdf';

/**
 * GET /api/admin/invoices/:id/pdf
 *
 * Downloads one issued invoice as a PDF.
 *
 * `adminReadGuard` re-checks the ADMIN role server-side (the page guard is not
 * what protects this URL), then the invoice quota applies because rendering is
 * real work. The document is built from the invoice's stored snapshots, never by
 * re-pricing the booking, so a download can never disagree with the issued
 * record.
 */
export const GET = apiHandler(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const guard = await adminReadGuard(request);
    if (!guard.ok) return guard.response;

    const limit = await rateLimitByUser(INVOICE_POLICY, guard.user.id);
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

    const id = await readIdParam(context.params);

    const invoice = await getInvoiceById(id);
    if (!invoice) {
      throw new ApiError('NOT_FOUND', 'Invoice not found', 404);
    }

    return pdfResponse(invoice.number, renderInvoicePdf(toInvoicePdfDocument(invoice)));
  },
);
