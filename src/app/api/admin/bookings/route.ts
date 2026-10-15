import { apiHandler, jsonOk } from '@/lib/api';
import { adminReadGuard } from '@/lib/admin-api';
import { listAllBookings } from '@/lib/customer-bookings';
import { adminBookingQuerySchema } from '@/lib/validation';

/**
 * GET /api/admin/bookings
 *
 * The operations booking table: reference search, status filter and
 * pagination.
 *
 * `adminReadGuard` proves a live ADMIN session and rate-limits the read before
 * the query is parsed. The `.strict()` schema validates every parameter - the
 * status is an allowlist of the canonical booking statuses plus `ALL`, and page
 * bounds stop a single request from asking for an unbounded scan - so an
 * unrecognised filter is rejected rather than forwarded to the database.
 *
 * The projection is explicit (see `listAllBookings`): rows carry the customer's
 * name and the service location, but no phone number, email or street address.
 * Dispatch decisions do not need them in a list view, and a table row is the
 * worst place to expose them.
 */
export const GET = apiHandler(async (request: Request) => {
  const guard = await adminReadGuard(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const query = adminBookingQuerySchema.parse(Object.fromEntries(url.searchParams));

  const result = await listAllBookings({
    q: query.q,
    // `ALL` means "no status constraint", not a status to match.
    status: query.status === 'ALL' ? undefined : query.status,
    page: query.page,
    pageSize: query.pageSize,
  });

  return jsonOk({ ...result, page: query.page, pageSize: query.pageSize });
});