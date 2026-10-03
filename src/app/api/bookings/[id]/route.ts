import { ApiError, apiHandler, jsonOk, tooManyRequests } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { READ_POLICY, rateLimitByUser } from '@/lib/rate-limit';
import { loadBookingForActor } from '@/lib/access';

/**
 * GET /api/bookings/:id
 *
 * Returns ONE booking, scoped to the actor in the QUERY rather than fetched by
 * id and filtered afterwards.
 *
 * IDOR NOTE: `loadBookingForActor` builds the `where` clause from the session
 * user, so for a CUSTOMER the clause always includes `customerId: <their own
 * id>`. Changing the id in the URL therefore cannot reach another customer's
 * record - it simply matches nothing. `apiHandler` turns the thrown ApiError
 * into the same `404 NOT_FOUND` body that a genuinely missing record produces,
 * so the endpoint cannot be used to discover which booking ids exist.
 */
export const GET = apiHandler(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const user = await requireUser();

    const limit = await rateLimitByUser(READ_POLICY, user.id);
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

    const { id } = await context.params;

    const booking = await loadBookingForActor(id, user);
    if (!booking) {
      throw new ApiError('NOT_FOUND', 'Booking not found', 404);
    }

    return jsonOk({ booking });
  },
);
