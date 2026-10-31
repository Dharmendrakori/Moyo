import { audit } from '@/lib/audit';
import { assertCsrf, assertSameOrigin, requireUser } from '@/lib/auth';
import { ApiError, apiHandler, jsonOk, parseJson } from '@/lib/api';
import { ADMIN_MUTATION_POLICY, rateLimitByUser } from '@/lib/rate-limit';
import { bookingTransitionSchema } from '@/lib/validation';
import { assertCanManageBooking } from '@/lib/access';
import { assertAssignableTechnician } from '@/lib/technicians';
import { evaluateTransition } from '@/lib/booking-state';
import { prisma } from '@/lib/prisma';
import { isBookingStatus, type BookingStatus } from '@/lib/domain';

/**
 * POST /api/bookings/:id/transition
 *
 * Moves a booking to its next state.
 *
 * Three independent guards, all enforced server-side:
 *  1. OWNERSHIP  - the actor must own the booking (admin sees all; a provider
 *                  only its own; a technician only assigned bookings).
 *  2. STATE MACHINE - the requested transition must be a legal edge.
 *  3. ROLE MATRIX - the actor's role must be permitted to make that edge.
 *
 * A client cannot jump a booking to PAID: that edge has no permitted role and
 * is only reachable through the verified payment webhook.
 */
export const POST = apiHandler(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    assertSameOrigin(request);

    const user = await requireUser();
    await assertCsrf(request);

    const limit = await rateLimitByUser(ADMIN_MUTATION_POLICY, user.id);
    if (!limit.allowed) {
      throw new ApiError('RATE_LIMITED', 'Too many requests. Please slow down.', 429);
    }

    const { id } = await context.params;
    const body = await parseJson(request, bookingTransitionSchema);

    // Guard 1: ownership. Returns null for both "not found" and "not yours" so
    // the response cannot be used to discover which booking ids exist.
    const booking = await assertCanManageBooking(id, user);
    if (!booking) {
      throw new ApiError('NOT_FOUND', 'Booking not found', 404);
    }

    // Re-validate the stored status before using it for a decision.
    if (!isBookingStatus(booking.status)) {
      throw new ApiError('INVALID_STATE', 'This booking is in an unexpected state', 409);
    }

    const current = booking.status;
    const desired = body.nextStatus as BookingStatus;

    // Guard 2 + 3: legal transition and permitted role.
    const decision = evaluateTransition(current, desired, user.role);
    if (!decision.ok) {
      await audit({
        action: 'ACCESS_DENIED',
        entityType: 'Booking',
        entityId: id,
        actorId: user.id,
        actorRole: user.role,
        metadata: { attempted: desired, from: current, code: decision.code },
      });
      throw new ApiError('INVALID_TRANSITION', decision.reason, 409);
    }

    // Technician assignment is a separate, admin/provider-only action. The FULL
    // eligibility rule lives in one place: existence, provider membership,
    // activation and availability. Assigning an edge without naming a technician
    // is refused, because a TECHNICIAN_ASSIGNED booking with no technician is a
    // booking nobody can service.
    let technicianId = booking.technicianId;
    if (desired === 'TECHNICIAN_ASSIGNED') {
      if (!body.technicianId) {
        throw new ApiError(
          'TECHNICIAN_REQUIRED',
          'Select the technician who will carry out this booking.',
          422,
        );
      }
      const technician = await assertAssignableTechnician(body.technicianId, booking.providerId);
      technicianId = technician.id;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.booking.update({
        where: { id },
        data: {
          status: desired,
          ...(technicianId !== booking.technicianId ? { technicianId } : {}),
        },
        select: { id: true, reference: true, status: true, technicianId: true },
      });

      await tx.bookingStatusEvent.create({
        data: {
          bookingId: id,
          from: current,
          to: desired,
          actorId: user.id,
          actorRole: user.role,
          note: body.note || null,
        },
      });

      return result;
    });

    await audit({
      action:
        desired === 'CANCELLED' ? 'BOOKING_CANCELLED' : 'BOOKING_STATUS_CHANGED',
      entityType: 'Booking',
      entityId: id,
      actorId: user.id,
      actorRole: user.role,
      metadata: { from: current, to: desired, reference: updated.reference },
    });

    if (desired === 'TECHNICIAN_ASSIGNED' && technicianId) {
      await audit({
        action: 'TECHNICIAN_ASSIGNED',
        entityType: 'Booking',
        entityId: id,
        actorId: user.id,
        actorRole: user.role,
        metadata: { technicianId },
      });
    }

    return jsonOk({ booking: updated });
  },
);