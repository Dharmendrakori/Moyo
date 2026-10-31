/**
 * CUSTOMER BOOKING TRACKING VIEW MODEL
 *
 * PURE FUNCTIONS ONLY - no database, no `server-only` import, no React. This
 * module turns a stored booking into exactly what the tracking UI needs, and is
 * unit tested directly.
 *
 * TWO RULES ARE ENCODED HERE AND TESTED:
 *
 *  1. A stage is only ever reported as `complete` when the backend says so. Any
 *     stage after the current one is `pending` - the UI must never imply that
 *     future work has already happened.
 *  2. A published price is only ever labelled as an ESTIMATE. The authoritative
 *     amount is the final invoice, which is produced after the work is done.
 */

import { BOOKING_FLOW, STATUS_HINT, STATUS_LABEL } from './booking-state';
import { CHARGING_LABEL, isBookingStatus, type BookingStatus } from './domain';

export type StageState = 'complete' | 'current' | 'pending';

export type LifecycleStage = {
  status: BookingStatus;
  label: string;
  state: StageState;
  /** Index in BOOKING_FLOW, for stable ordering and stable React keys. */
  order: number;
};

export type LifecycleProjection = {
  /** Null only when the stored status is not a recognised value. */
  currentStatus: BookingStatus | null;
  currentLabel: string;
  currentHint: string;
  isCancelled: boolean;
  isTerminal: boolean;
  /** 0-based position in BOOKING_FLOW. -1 for CANCELLED or an unknown value. */
  currentIndex: number;
  totalSteps: number;
  /** Stages strictly before the current one. */
  completedCount: number;
  stages: LifecycleStage[];
  /** Honest, action-oriented copy. Null when nothing is left to do. */
  nextAction: string | null;
};

/**
 * Next action per state.
 *
 * Deliberately contains no ETA, no arrival promise and no availability claim,
 * because the booking record does not contain those facts. A unit test asserts
 * that none of these strings smuggle in a time guarantee.
 */
const NEXT_ACTION: Record<BookingStatus, string | null> = {
  REQUESTED: 'Awaiting confirmation from the provider.',
  CONFIRMED: 'A technician will be assigned to this booking.',
  TECHNICIAN_ASSIGNED: 'Technician assigned. You can reach them using the details below.',
  TECHNICIAN_ON_THE_WAY: 'The technician has marked themselves on the way.',
  ARRIVED: 'The technician has arrived at your location.',
  SERVICE_IN_PROGRESS: 'Work is underway.',
  COMPLETED: 'Work is complete. The invoice is being prepared.',
  INVOICE_GENERATED: 'Your invoice is ready to review.',
  PAYMENT_PENDING: 'Payment is pending and will update from the payment provider.',
  PAID: 'Payment confirmed.',
  FEEDBACK_PENDING: 'Feedback can be left once the review flow is available.',
  CLOSED: null,
  CANCELLED: null,
};

/**
 * Projects the fixed booking lifecycle against a stored status.
 *
 * Stages BEFORE the current status are `complete`, the current one is
 * `current`, and every stage AFTER it stays `pending`. Cancelled bookings have
 * no position in the happy path, so every stage is reported as `pending` and
 * the UI shows a dedicated cancelled state instead of a false progress bar.
 */
export function projectLifecycle(status: string): LifecycleProjection {
  const totalSteps = BOOKING_FLOW.length;

  // Defensive: a legacy or tampered row must not crash the page and must never
  // silently render as though the booking were complete.
  if (!isBookingStatus(status)) {
    return {
      currentStatus: null,
      currentLabel: 'Unknown status',
      currentHint: 'This booking is in a state the platform does not recognise.',
      isCancelled: false,
      isTerminal: true,
      currentIndex: -1,
      totalSteps,
      completedCount: 0,
      stages: BOOKING_FLOW.map((s, order) => ({
        status: s,
        label: STATUS_LABEL[s],
        state: 'pending' as StageState,
        order,
      })),
      nextAction: null,
    };
  }

  const currentStatus: BookingStatus = status;
  const currentIndex = BOOKING_FLOW.indexOf(currentStatus);
  const isCancelled = currentStatus === 'CANCELLED';

  const stages: LifecycleStage[] = BOOKING_FLOW.map((s, order) => ({
    status: s,
    label: STATUS_LABEL[s],
    state: isCancelled
      ? 'pending'
      : order < currentIndex
        ? 'complete'
        : order === currentIndex
          ? 'current'
          : 'pending',
    order,
  }));

  return {
    currentStatus,
    currentLabel: STATUS_LABEL[currentStatus],
    currentHint: STATUS_HINT[currentStatus],
    isCancelled,
    isTerminal: isCancelled || currentStatus === 'CLOSED',
    currentIndex: isCancelled ? -1 : currentIndex,
    totalSteps,
    completedCount: isCancelled ? 0 : currentIndex,
    stages,
    nextAction: NEXT_ACTION[currentStatus],
  };
}

// --- Pricing ----------------------------------------------------------------

export type PriceKind = 'published' | 'budget' | 'unpublished';

export type PriceSummary = {
  kind: PriceKind;
  charging: string;
  chargingLabel: string;
  quotedPaise: number | null;
  budgetMinPaise: number | null;
  budgetMaxPaise: number | null;
  /** Short label for the figure, in words. Never a currency amount on its own. */
  headline: string;
  /**
   * The sentence that keeps the estimate and the final invoice distinct. It
   * must never present a published price as the amount the customer will pay.
   */
  note: string;
};

const ESTIMATE_NOTE =
  'This is a published service price, not the final invoice. The final invoice is generated after the work is completed.';

/**
 * Summarises what a booking actually costs, as stored.
 *
 * The three outcomes are kept strictly distinct:
 *   - `published`   a real published price exists
 *   - `budget`      the customer supplied a budget and no fixed price applies
 *   - `unpublished` the provider has not published a price; the UI must say so
 *
 * A `null` quote is NEVER rendered as zero and never as a guess.
 */
export function summarisePrice(input: {
  charging: string;
  quotedPaise: number | null;
  budgetMinPaise: number | null;
  budgetMaxPaise: number | null;
}): PriceSummary {
  const base = {
    charging: input.charging,
    chargingLabel: CHARGING_LABEL[input.charging as keyof typeof CHARGING_LABEL] ?? input.charging,
    quotedPaise: input.quotedPaise,
    budgetMinPaise: input.budgetMinPaise,
    budgetMaxPaise: input.budgetMaxPaise,
  };

  if (input.quotedPaise != null && input.quotedPaise > 0) {
    return { ...base, kind: 'published', headline: 'Published service price (estimate)', note: ESTIMATE_NOTE };
  }

  if (input.budgetMinPaise != null && input.budgetMaxPaise != null) {
    return {
      ...base,
      kind: 'budget',
      headline: 'Your budget range',
      note: 'No fixed price applies. The provider confirms what can be delivered within your budget, and the final invoice follows the work completed.',
    };
  }

  return {
    ...base,
    kind: 'unpublished',
    headline: 'Price not published',
    note: 'The provider has not published a price for this charging option. The amount will be confirmed after the visit, and the final invoice follows the work completed.',
  };
}

/**
 * True when the backend has actually assigned a technician to this booking.
 *
 * The tracking UI uses this to choose between real technician details and the
 * honest "details will appear after assignment" placeholder. It exists so no
 * screen has to invent its own truthiness check on a nullable relation.
 */
export function hasAssignedTechnician(
  technician: { displayName: string } | null | undefined,
): boolean {
  return Boolean(technician && technician.displayName.trim().length > 0);
}

