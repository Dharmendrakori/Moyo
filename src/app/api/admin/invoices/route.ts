import { apiHandler, jsonOk } from '@/lib/api';
import { adminReadGuard } from '@/lib/admin-api';
import { listInvoices } from '@/lib/invoice';
import { adminInvoiceQuerySchema } from '@/lib/validation';

/**
 * GET /api/admin/invoices
 *
 * The issued-invoice ledger: number / booking / customer search, a status filter
 * and server-side pagination.
 *
 * `adminReadGuard` proves a live ADMIN session and rate-limits the read before
 * the query is parsed. The `.strict()` schema means an unrecognised parameter is
 * refused rather than forwarded into a database filter, and the status is the
 * canonical allowlist plus `ALL`.
 *
 * The projection is explicit (see `listInvoices`): a row carries the invoice
 * number, booking reference and customer NAME only - no contact details, no
 * snapshot bodies.
 */
export const GET = apiHandler(async (request: Request) => {
  const guard = await adminReadGuard(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const query = adminInvoiceQuerySchema.parse(Object.fromEntries(url.searchParams));

  const result = await listInvoices({
    q: query.q,
    // `ALL` means "no status constraint", not a status to match.
    status: query.status === 'ALL' ? undefined : query.status,
    page: query.page,
    pageSize: query.pageSize,
  });

  return jsonOk({ ...result, page: query.page, pageSize: query.pageSize });
});
