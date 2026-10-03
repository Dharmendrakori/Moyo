import { assertCsrf, assertSameOrigin, requireUser } from '@/lib/auth';
import { ApiError, apiHandler, jsonOk, parseJson, tooManyRequests } from '@/lib/api';
import { QUOTE_POLICY, rateLimitByUser } from '@/lib/rate-limit';
import { quoteSchema } from '@/lib/validation';
import { PricingError, resolveBookingPricing } from '@/lib/pricing';
import { prisma } from '@/lib/prisma';
import type { ChargingOption } from '@/lib/domain';

/**
 * POST /api/bookings/quote
 *
 * Resolves what a booking WOULD cost, so the confirmation step can display a
 * server-authoritative figure before anything is written.
 *
 * SECURITY PROPERTIES:
 *  - The request body has no field for a price. `quoteSchema` is `.strict()`,
 *    so posting `{ quotedPaise: 1 }` is rejected outright rather than ignored.
 *  - The figure comes from `resolveBookingPricing`, the same function the
 *    booking-creation route uses. There is no second, weaker pricing path.
 *  - The service must exist, be active, and have an active provider - otherwise
 *    a quote could be produced for something that cannot actually be booked.
 *
 * Nothing is persisted by this route.
 */
export const POST = apiHandler(async (request: Request) => {
  assertSameOrigin(request);

  const user = await requireUser();
  await assertCsrf(request);

  const limit = await rateLimitByUser(QUOTE_POLICY, user.id);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const body = await parseJson(request, quoteSchema);

  const service = await prisma.service.findFirst({
    where: { id: body.serviceId, isActive: true },
    select: { id: true, providers: { where: { provider: { isActive: true } }, take: 1, select: { providerId: true } } },
  });

  if (!service) {
    throw new ApiError('SERVICE_UNAVAILABLE', 'This service is no longer available', 404);
  }
  if (service.providers.length === 0) {
    throw new ApiError(
      'PROVIDER_UNAVAILABLE',
      'No active provider is currently offering this service',
      409,
    );
  }

  try {
    const pricing = await resolveBookingPricing(
      body.serviceId,
      body.charging as ChargingOption,
      body.budgetMin ?? null,
      body.budgetMax ?? null,
    );

    return jsonOk({
      quote: {
        charging: pricing.charging,
        quotedPaise: pricing.quotedPaise,
        budgetMinPaise: pricing.budgetMinPaise,
        budgetMaxPaise: pricing.budgetMaxPaise,
      },
    });
  } catch (err) {
    if (err instanceof PricingError) {
      throw new ApiError(err.code, err.message, 422);
    }
    throw err;
  }
});
