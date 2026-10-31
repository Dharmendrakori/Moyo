import { audit } from '@/lib/audit';
import { adminWriteGuard, asAdminActor, readIdParam } from '@/lib/admin-api';
import { ApiError, apiHandler, jsonOk, parseJson } from '@/lib/api';
import { ADMIN_MUTATION_POLICY, rateLimitByUser } from '@/lib/rate-limit';
import { adminAssignTechnicianSchema } from '@/lib/validation';
import { evaluateTransition } from '@/lib/booking-state';
import { isBookingStatus } from '@/lib/domain';
import { assertCanManageBooking } from '@/lib/access';
import { assertAssignableTechnician } from '@/lib/technicians';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/admin/bookings/:id/assign-technician
 *
 * Assigns a technician to a CONFIRMED booking: CONFIRMED -> TECHNICIAN_ASSIGNED.
 *
 * Only a valid, active technician record belonging to this booking's provider
 * may be assigned. The update is conditional on the current status, so
 * concurrent or duplicate assignment attempts cannot silently overwrite one
 * another: only one assignment can persist for a CONFIRMED booking.
 *
 * Reassignment is intentionally NOT supported here: once a booking has moved
 * past CONFIRMED it cannot be re-assigned through this endpoint, which is the
 * domain rule enforced by the state machine.
 */
export const POST = apiHandler(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const guard = await adminWriteGuard(request);
    if (!guard.ok) return guard.response;

    const id = await readIdParam(context.params);
    const body = await parseJson(request, adminAssignTechnicianSchema);

    const actor = asAdminActor(guard.user);
    const booking = await assertCanManageBooking(id, actor);
    if (!booking) {
      throw new ApiError('NOT_FOUND', 'Booking not found', 404);
    }

    if (!isBookingStatus(booking.status)) {
      throw new ApiError('INVALID_STATE', 'This booking is in an unexpected state', 409);
    }

    const decision = evaluateTransition(booking.status, 'TECHNICIAN_ASSIGNED', 'ADMIN');
    if (!decision.ok) {
      await audit({
        action: 'ACCESS_DENIED',
        entityType: 'Booking',
        entityId: id,
        actorId: guard.user.id,
        actorRole: 'ADMIN',
        metadata: { attempted: 'TECHNICIAN_ASSIGNED', from: booking.status, code: decision.code },
      });
      throw new ApiError('INVALID_TRANSITION', decision.reason, 409);
    }

    // Existence, provider membership, activation AND availability, decided once
    // in `assertAssignableTechnician` so this endpoint and the generic transition
    // endpoint cannot disagree about what "assignable" means.
    const technician = await assertAssignableTechnician(body.technicianId, booking.providerId);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.booking.update({
        where: { id, status: 'CONFIRMED' },
        data: { status: 'TECHNICIAN_ASSIGNED', technicianId: technician.id },
        select: { id: true, reference: true, status: true, technicianId: true },
      });
      if (!result) {
        throw new ApiError('CONFLICT', 'This booking was already assigned or moved by another operator', 409);
      }

      await tx.bookingStatusEvent.create({
        data: {
          bookingId: id,
          from: booking.status,
          to: 'TECHNICIAN_ASSIGNED',
          actorId: guard.user.id,
          actorRole: 'ADMIN',
          note: null,
        },
      });

      return result;
    });

    await audit({
      action: 'BOOKING_STATUS_CHANGED',
      entityType: 'Booking',
      entityId: id,
      actorId: guard.user.id,
      actorRole: 'ADMIN',
      metadata: {
        from: booking.status,
        to: 'TECHNICIAN_ASSIGNED',
        reference: updated.reference,
        technicianId: technician.id,
      },
    });

    await audit({
      action: 'TECHNICIAN_ASSIGNED',
      entityType: 'Booking',
      entityId: id,
      actorId: guard.user.id,
      actorRole: 'ADMIN',
      metadata: {
        reference: updated.reference,
        technicianId: technician.id,
        technicianName: technician.displayName,
        previousTechnicianId: booking.technicianId ?? null,
        newTechnicianId: technician.id,
      },
    });

    return jsonOk({ booking: updated });
  },
);