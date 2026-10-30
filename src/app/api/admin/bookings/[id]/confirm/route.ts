import { audit } from '@/lib/audit';
import { adminWriteGuard, asAdminActor, readIdParam } from '@/lib/admin-api';
import { ApiError, apiHandler, jsonOk, parseJson } from '@/lib/api';
import { ADMIN_MUTATION_POLICY, rateLimitByUser } from '@/lib/rate-limit';
import { adminConfirmBookingSchema } from '@/lib/validation';
import { evaluateTransition } from '@/lib/booking-state';
import { isBookingStatus } from '@/lib/domain';
import { assertCanManageBooking } from '@/lib/access';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/admin/bookings/:id/confirm
 *
 * Confirms a REQUESTED booking: REQUESTED -> CONFIRMED.
 *
 * The client requests an ACTION, not a target status - the server resolves the
 * resulting state through the booking state machine, so an arbitrary jump is
 * structurally impossible. The update is conditional on the current status,
 * which makes concurrent confirmation attempts safe: only one can succeed.
 */
export const POST = apiHandler(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const guard = await adminWriteGuard(request);
    if (!guard.ok) return guard.response;

    const id = await readIdParam(context.params);
    await parseJson(request, adminConfirmBookingSchema);

    const actor = asAdminActor(guard.user);
    const booking = await assertCanManageBooking(id, actor);
    if (!booking) {
      throw new ApiError('NOT_FOUND', 'Booking not found', 404);
    }

    if (!isBookingStatus(booking.status)) {
      throw new ApiError('INVALID_STATE', 'This booking is in an unexpected state', 409);
    }

    const decision = evaluateTransition(booking.status, 'CONFIRMED', 'ADMIN');
    if (!decision.ok) {
      await audit({
        action: 'ACCESS_DENIED',
        entityType: 'Booking',
        entityId: id,
        actorId: guard.user.id,
        actorRole: 'ADMIN',
        metadata: { attempted: 'CONFIRMED', from: booking.status, code: decision.code },
      });
      throw new ApiError('INVALID_TRANSITION', decision.reason, 409);
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Conditional on the current status: a racing confirmation that already
      // moved the booking will match zero rows here.
      const result = await tx.booking.update({
        where: { id, status: 'REQUESTED' },
        data: { status: 'CONFIRMED' },
        select: { id: true, reference: true, status: true, technicianId: true },
      });
      if (!result) {
        throw new ApiError('CONFLICT', 'This booking was already updated by another operator', 409);
      }

      await tx.bookingStatusEvent.create({
        data: {
          bookingId: id,
          from: booking.status,
          to: 'CONFIRMED',
          actorId: guard.user.id,
          actorRole: 'ADMIN',
          note: null,
        },
      });

      return result;
    });

    await audit({
      action: 'BOOKING_CONFIRMED',
      entityType: 'Booking',
      entityId: id,
      actorId: guard.user.id,
      actorRole: 'ADMIN',
      metadata: { from: booking.status, to: 'CONFIRMED', reference: updated.reference },
    });

    return jsonOk({ booking: updated });
  },
);