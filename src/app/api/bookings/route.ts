import { audit } from '@/lib/audit';
import { assertCsrf, assertSameOrigin, requireUser } from '@/lib/auth';
import { ApiError, apiHandler, jsonOk, parseJson, tooManyRequests } from '@/lib/api';
import { BOOKING_POLICY, READ_POLICY, rateLimitByUser } from '@/lib/rate-limit';
import { createBookingSchema } from '@/lib/validation';
import { prisma } from '@/lib/prisma';
import {
  PricingError,
  nextReference,
  normaliseServiceType,
  resolveBookingPricing,
} from '@/lib/pricing';
import { listCustomerBookings } from '@/lib/customer-bookings';
import type { ChargingOption } from '@/lib/domain';

/**
 * GET /api/bookings
 *
 * Lists the AUTHENTICATED CUSTOMER'S OWN bookings.
 *
 * Ownership is not a parameter here: `user.id` comes from the session and is
 * passed straight into a query that is itself scoped by `customerId`. A caller
 * cannot widen the result set by supplying an id, because the schema for these
 * query parameters has no field that could carry one.
 */
export const GET = apiHandler(async (request: Request) => {
  const user = await requireUser();

  const limit = await rateLimitByUser(READ_POLICY, user.id);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const url = new URL(request.url);

  // Parsed defensively: an unrecognised value simply falls back to the default
  // rather than reaching a query. `page`/`pageSize` are bounded integers.
  const rawPage = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(rawPage) ? Math.min(10_000, Math.max(1, Math.floor(rawPage))) : 1;
  const rawSize = Number(url.searchParams.get('pageSize') ?? '10');
  const pageSize = Number.isFinite(rawSize) ? Math.min(50, Math.max(1, Math.floor(rawSize))) : 10;
  const status = url.searchParams.get('status') ?? undefined;

  const { items, total } = await listCustomerBookings(user.id, { status, page, pageSize });

  return jsonOk({ items, total, page, pageSize });
});


/**
 * POST /api/bookings
 *
 * Creates a booking for the AUTHENTICATED customer.
 *
 * Never trust from the request:
 *   - customerId   -> always taken from the session
 *   - providerId   -> resolved from the service's published provider
 *   - quotedPaise  -> resolved server-side (see lib/pricing.ts)
 *   - role/status  -> fixed by the server (always starts at REQUESTED)
 */
export const POST = apiHandler(async (request: Request) => {
  assertSameOrigin(request);

  const user = await requireUser();
  await assertCsrf(request);

  const limit = await rateLimitByUser(BOOKING_POLICY, user.id);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const body = await parseJson(request, createBookingSchema);

  // Resolve the service AND its active provider in one scoped query. An
  // inactive service or one with no active provider cannot be booked.
  const service = await prisma.service.findFirst({
    where: { id: body.serviceId, isActive: true },
    select: {
      id: true,
      serviceType: true,
      providers: {
        where: { provider: { isActive: true } },
        take: 1,
        select: { providerId: true },
      },
    },
  });

  if (!service) {
    throw new ApiError('SERVICE_UNAVAILABLE', 'This service is no longer available', 404);
  }

  const providerId = service.providers[0]?.providerId;
  if (!providerId) {
    throw new ApiError(
      'PROVIDER_UNAVAILABLE',
      'No active provider is currently offering this service',
      409,
    );
  }

  // Server-side pricing. Any client-supplied price is ignored.
  let pricing;
  try {
    pricing = await resolveBookingPricing(
      body.serviceId,
      body.charging as ChargingOption,
      body.budgetMin ?? null,
      body.budgetMax ?? null,
    );
  } catch (err) {
    if (err instanceof PricingError) {
      throw new ApiError(err.code, err.message, 422);
    }
    throw err;
  }

  const reference = await nextReference('SERIC');

  const booking = await prisma.$transaction(async (tx) => {
    const created = await tx.booking.create({
      data: {
        reference,
        // Ownership comes from the session, never from the request body.
        customerId: user.id,
        providerId,
        serviceId: service.id,
        // Always starts at REQUESTED. A client cannot set this.
        status: 'REQUESTED',
        mode: body.mode,
        serviceType: normaliseServiceType(body.serviceType, service.serviceType),
        charging: pricing.charging,
        quotedPaise: pricing.quotedPaise,
        budgetMinPaise: pricing.budgetMinPaise,
        budgetMaxPaise: pricing.budgetMaxPaise,
        scheduledFor: body.scheduledFor ?? null,
        addressLine1: body.address.line1,
        addressLine2: body.address.line2 || null,
        area: body.address.area,
        city: body.address.city,
        state: body.address.state,
        pincode: body.address.pincode,
        landmark: body.address.landmark || null,
        contactName: body.contactName,
        contactPhone: body.contactPhone,
        description: body.description || null,
        isEmergency: body.mode === 'EMERGENCY',
      },
      select: {
        id: true,
        reference: true,
        status: true,
        charging: true,
        quotedPaise: true,
        budgetMinPaise: true,
        budgetMaxPaise: true,
        scheduledFor: true,
        service: { select: { name: true } },
      },
    });

    await tx.bookingStatusEvent.create({
      data: {
        bookingId: created.id,
        from: null,
        to: 'REQUESTED',
        actorId: user.id,
        actorRole: user.role,
        note: 'Booking created by customer',
      },
    });

    return created;
  });

  await audit({
    action: 'BOOKING_CREATED',
    entityType: 'Booking',
    entityId: booking.id,
    actorId: user.id,
    actorRole: user.role,
    metadata: { reference: booking.reference, charging: booking.charging },
  });

  // Notify the operations queue. In-app only until a real channel is wired.
  await prisma.notification.create({
    data: {
      userId: user.id,
      channel: 'IN_APP',
      title: `Booking ${booking.reference} received`,
      body: 'Your request has been recorded. Confirmation follows shortly.',
      link: `/bookings/${booking.id}`,
      status: 'SENT',
    },
  });

  return jsonOk({ booking }, { status: 201 });
});