import { ApiError, apiHandler, jsonOk } from '@/lib/api';
import { adminReadGuard, readIdParam } from '@/lib/admin-api';
import { loadBookingForActor } from '@/lib/access';

/**
 * GET /api/admin/bookings/:id
 *
 * Returns one booking's full details for the dispatch view.
 *
 * `loadBookingForActor` scopes the query by the actor in the query itself, so
 * an ADMIN can read any booking and the response never reveals another
 * operator's record through an id-guessing probe - admin is the only role that
 * reaches this endpoint, and it sees every booking.
 */
export const GET = apiHandler(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const guard = await adminReadGuard(request);
    if (!guard.ok) return guard.response;

    const id = await readIdParam(context.params);

    const booking = await loadBookingForActor(id, {
      id: guard.user.id,
      role: 'ADMIN',
      providerId: null,
      technicianId: null,
    });
    if (!booking) {
      throw new ApiError('NOT_FOUND', 'Booking not found', 404);
    }

    return jsonOk({ booking });
  },
);