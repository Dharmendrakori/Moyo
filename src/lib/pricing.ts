import 'server-only';
import { prisma } from './prisma';
import {
  BUDGET_CEILING_PAISE,
  BUDGET_FLOOR_PAISE,
} from './validation';
import type {
  ChargingOption,
  BookingMode,
  ServiceType,
} from './domain';

/**
 * SERVER-SIDE PRICING
 *
 * The single source of truth for what a booking costs.
 *
 * CRITICAL SECURITY RULE: a client may choose WHICH charging option to use,
 * but it may never choose HOW MUCH it costs. `quotedPaise` is resolved here
 * from the `ServiceOption` row and snapshotted onto the booking. Any price
 * posted by a client is ignored entirely.
 */

export type ResolvedPricing = {
  charging: ChargingOption;
  /** Null when the provider has not published a price for this option. */
  quotedPaise: number | null;
  budgetMinPaise: number | null;
  budgetMaxPaise: number | null;
};

export class PricingError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'OPTION_NOT_AVAILABLE'
      | 'PRICE_NOT_PUBLISHED'
      | 'BUDGET_REQUIRED'
      | 'BUDGET_OUT_OF_RANGE',
  ) {
    super(message);
    this.name = 'PricingError';
  }
}

/**
 * Resolves the price for a booking.
 *
 * @param serviceId     the chosen service
 * @param charging      the chosen charging option (allowlisted)
 * @param budgetMin/Max customer budget in paise, only for CUSTOMER_BUDGET
 */
export async function resolveBookingPricing(
  serviceId: string,
  charging: ChargingOption,
  budgetMin?: number | null,
  budgetMax?: number | null,
): Promise<ResolvedPricing> {
  const option = await prisma.serviceOption.findFirst({
    where: { serviceId, charging, isActive: true },
    select: { pricePaise: true, budgetMinPaise: true, budgetMaxPaise: true },
  });

  if (!option) {
    throw new PricingError(
      'This charging option is not available for the selected service.',
      'OPTION_NOT_AVAILABLE',
    );
  }

  // Visit charge and fixed charge must have a published price.
  if (charging !== 'CUSTOMER_BUDGET') {
    if (option.pricePaise == null || option.pricePaise <= 0) {
      throw new PricingError(
        'The provider has not published a price for this option yet. Please choose another option or contact the provider.',
        'PRICE_NOT_PUBLISHED',
      );
    }
    return {
      charging,
      quotedPaise: option.pricePaise,
      budgetMinPaise: null,
      budgetMaxPaise: null,
    };
  }

  // Customer budget: both bounds required and must sit inside the published range.
  if (budgetMin == null || budgetMax == null) {
    throw new PricingError(
      'Enter both a minimum and a maximum budget.',
      'BUDGET_REQUIRED',
    );
  }

  if (budgetMin > budgetMax) {
    throw new PricingError(
      'The minimum budget cannot be greater than the maximum budget.',
      'BUDGET_OUT_OF_RANGE',
    );
  }

  // Bounds the customer may enter, when the provider has published them.
  const floor = Math.max(option.budgetMinPaise ?? BUDGET_FLOOR_PAISE, BUDGET_FLOOR_PAISE);
  const ceiling = Math.min(
    option.budgetMaxPaise ?? BUDGET_CEILING_PAISE,
    BUDGET_CEILING_PAISE,
  );

  if (budgetMin < floor || budgetMax > ceiling) {
    throw new PricingError(
      `Your budget must be between ₹${Math.floor(floor / 100)} and ₹${Math.ceil(ceiling / 100)}.`,
      'BUDGET_OUT_OF_RANGE',
    );
  }

  return {
    charging,
    // No fixed quote exists for a customer budget: the provider confirms scope.
    quotedPaise: null,
    budgetMinPaise: budgetMin,
    budgetMaxPaise: budgetMax,
  };
}

/**
 * Builds a human-friendly, sequential reference (e.g. SERIC-2026-000123).
 * Uses an atomic upsert on the Counter table to avoid a racy max()+1.
 */
export async function nextReference(prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const key = `${prefix}-${year}`;

  const counter = await prisma.counter.upsert({
    where: { key },
    update: { value: { increment: 1 } },
    create: { key, value: 1 },
  });

  return `${prefix}-${year}-${String(counter.value).padStart(6, '0')}`;
}

/** Normalises and narrows a stored service type before it is persisted. */
export function normaliseServiceType(value: string | undefined, fallback: string): ServiceType {
  const candidate = value ?? fallback;
  const allowed: ServiceType[] = [
    'REPAIR',
    'INSTALLATION',
    'UNINSTALLATION',
    'MAINTENANCE',
    'REPLACEMENT',
    'CUSTOMIZATION',
    'SPARE_PARTS',
    'SITE_VISIT',
    'CONSULTATION',
    'REMOTE_SUPPORT',
  ];
  return allowed.includes(candidate as ServiceType) ? (candidate as ServiceType) : 'SITE_VISIT';
}

/** Normalises and narrows a stored booking mode before it is persisted. */
export function normaliseBookingMode(value: string): BookingMode {
  const allowed: BookingMode[] = ['INSTANT', 'LATER', 'SCHEDULED', 'EMERGENCY'];
  return allowed.includes(value as BookingMode) ? (value as BookingMode) : 'INSTANT';
}