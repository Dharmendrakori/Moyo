import { apiHandler, jsonOk, parseJson } from '@/lib/api';
import { adminReadGuard, adminWriteGuard, asAdminActor } from '@/lib/admin-api';
import { bulkCreateServices, listAdminServices } from '@/lib/admin-catalog';
import { adminServiceCreateSchema, adminServiceQuerySchema } from '@/lib/validation';

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

/**
 * POST /api/admin/services
 *
 * Creates one or more services (bulk add).
 *
 * `adminWriteGuard` enforces the ADMIN session, CSRF, Origin and rate limiting
 * before the body is parsed. The `.strict()` schema validates every item's
 * subcategory, name and type and caps the batch. The slug is derived server
 * side; a duplicate name is reported as a skipped item, and each created service
 * gets its three charging options disabled and unpriced - a price is published
 * separately, never fabricated here.
 */
export const POST = apiHandler(async (request: Request) => {
  const guard = await adminWriteGuard(request);
  if (!guard.ok) return guard.response;

  const body = await parseJson(request, adminServiceCreateSchema);
  const result = await bulkCreateServices(body, asAdminActor(guard.user));

  return jsonOk({ result });
});
