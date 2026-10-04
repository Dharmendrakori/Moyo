import { apiHandler, jsonOk } from '@/lib/api';
import { adminReadGuard } from '@/lib/admin-api';
import { listAdminPricing } from '@/lib/admin-catalog';
import { adminPricingQuerySchema } from '@/lib/validation';

/**
 * GET /api/admin/pricing
 *
 * The published-pricing table, filterable by publication state, charging option
 * and category, with pagination.
 *
 * A row whose `pricePaise` is null is returned as UNPUBLISHED, which is the
 * honest state: nothing is seeded merely to make the console look complete.
 * While prices are unpublished the customer site continues to show its neutral
 * "on request" copy rather than a figure.
 */
export const GET = apiHandler(async (request: Request) => {
  const guard = await adminReadGuard(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const query = adminPricingQuerySchema.parse(Object.fromEntries(url.searchParams));

  const result = await listAdminPricing(query);
  return jsonOk(result);
});
