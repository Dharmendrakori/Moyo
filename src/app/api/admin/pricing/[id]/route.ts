import { apiHandler, jsonOk, parseJson } from '@/lib/api';
import { asAdminActor, adminWriteGuard, readIdParam } from '@/lib/admin-api';
import { setPublishedPrice } from '@/lib/admin-catalog';
import { adminPriceSchema } from '@/lib/validation';

/**
 * PATCH /api/admin/pricing/:id
 *
 * Publishes or withdraws the price for ONE charging option.
 *
 * THE MOST SENSITIVE MUTATION IN THE CONSOLE, so the controls are explicit:
 *
 *  - AUTHORIZATION: `adminWriteGuard` proves a live ADMIN session, verifies the
 *    CSRF token and checks the Origin before the body is even parsed.
 *  - NO MASS ASSIGNMENT: `adminPriceSchema` is `.strict()` and carries only
 *    `action` and `pricePaise`. Posting `serviceId`, `isActive`, `role` or any
 *    other key rejects the whole request. The row targeted is the URL id; a
 *    body can never redirect the change at a different service.
 *  - SERVER-OWNED AMOUNT: the price is a bounded integer of paise produced by
 *    validation, never a float or a formatted string, and the server writes it
 *    explicitly rather than spreading the parsed body into the update.
 *  - HISTORICAL QUOTES UNTOUCHED: only `ServiceOption` is written. Bookings
 *    keep the price snapshot they were created with, so re-pricing the
 *    catalogue can never silently rewrite an agreed quote.
 *  - HONEST STATE: an unpublished price is stored as NULL, which is exactly what
 *    the customer UI already renders as its neutral "on request" state.
 *  - AUDITED: publication and withdrawal are separate, distinct audit actions,
 *    and a failure to record the event is logged rather than swallowed.
 */
export const PATCH = apiHandler(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const guard = await adminWriteGuard(request);
  if (!guard.ok) return guard.response;

  const id = await readIdParam(context.params);
  const body = await parseJson(request, adminPriceSchema);

  const option = await setPublishedPrice(id, body, asAdminActor(guard.user));
  return jsonOk({ option });
});
