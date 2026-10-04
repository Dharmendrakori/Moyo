import { apiHandler, jsonOk } from '@/lib/api';
import { adminReadGuard } from '@/lib/admin-api';
import { listAdminServices } from '@/lib/admin-catalog';
import { adminServiceQuerySchema } from '@/lib/validation';

/**
 * GET /api/admin/services
 *
 * The service table, with search, filtering and pagination.
 *
 * Query parameters are validated by a `.strict()` schema before they can build a
 * Prisma `where`, so an unrecognised filter is rejected rather than forwarded
 * to the database. Every field is bounded (the search term is length-capped and
 * control-character stripped, page and pageSize are integers).
 *
 * The projection is explicit, so no password hash, session token or unrelated
 * personal column can reach the browser.
 */
export const GET = apiHandler(async (request: Request) => {
  const guard = await adminReadGuard(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const query = adminServiceQuerySchema.parse(Object.fromEntries(url.searchParams));

  const result = await listAdminServices(query);
  return jsonOk(result);
});
