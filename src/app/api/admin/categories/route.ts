import { apiHandler, jsonOk } from '@/lib/api';
import { adminReadGuard } from '@/lib/admin-api';
import { listAdminCategories } from '@/lib/admin-catalog';

/**
 * GET /api/admin/categories
 *
 * The authoritative 20 official categories, read from the database with live
 * service counts. There is deliberately no client-side copy of this list: a
 * duplicated constant would drift and would let the console show a category the
 * catalogue does not actually contain.
 *
 * Requires a server-verified ADMIN session. A CUSTOMER receives 403 and a
 * signed-out caller receives 401, both decided on the server.
 */
export const GET = apiHandler(async (request: Request) => {
  const guard = await adminReadGuard(request);
  if (!guard.ok) return guard.response;

  const categories = await listAdminCategories();
  return jsonOk({ categories, total: categories.length });
});
