import type { BookingStatus, Role } from './domain';

/**
 * BOOKING STATE MACHINE
 *
 * Server-side authority for what a booking may become next, and who may cause
 * it. Clients never send a target status blindly - they request an ACTION and
 * the server resolves the resulting state, so an arbitrary jump (e.g.
 * REQUESTED -> PAID) is structurally impossible.
 *
 * The customer-facing flow from the specification maps to:
 *   REQUESTED -> CONFIRMED -> TECHNICIAN_ASSIGNED -> TECHNICIAN_ON_THE_WAY
 *   -> ARRIVED -> SERVICE_IN_PROGRESS -> COMPLETED -> INVOICE_GENERATED
 *   -> PAYMENT_PENDING -> PAID -> FEEDBACK_PENDING -> CLOSED
 */

/** Ordered lifecycle used for progress indicators. */
export const BOOKING_FLOW: BookingStatus[] = [
  'REQUESTED',
  'CONFIRMED',
  'TECHNICIAN_ASSIGNED',
  'TECHNICIAN_ON_THE_WAY',
  'ARRIVED',
  'SERVICE_IN_PROGRESS',
  'COMPLETED',
  'INVOICE_GENERATED',
  'PAYMENT_PENDING',
  'PAID',
  'FEEDBACK_PENDING',
  'CLOSED',
];

export const TERMINAL_STATUSES: BookingStatus[] = ['CLOSED', 'CANCELLED'];

/** Allowed transitions. Terminal states have no outgoing edges. */
const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  REQUESTED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['TECHNICIAN_ASSIGNED', 'CANCELLED'],
  TECHNICIAN_ASSIGNED: ['TECHNICIAN_ON_THE_WAY', 'CANCELLED'],
  TECHNICIAN_ON_THE_WAY: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['SERVICE_IN_PROGRESS', 'CANCELLED'],
  SERVICE_IN_PROGRESS: ['COMPLETED'],
  COMPLETED: ['INVOICE_GENERATED'],
  INVOICE_GENERATED: ['PAYMENT_PENDING'],
  PAYMENT_PENDING: ['PAID'],
  PAID: ['FEEDBACK_PENDING'],
  FEEDBACK_PENDING: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

/** Which roles may initiate a transition out of a given state. */
const TRANSITION_ROLES: Record<BookingStatus, Role[]> = {
  REQUESTED: ['ADMIN', 'PROVIDER'],
  CONFIRMED: ['ADMIN', 'PROVIDER'],
  TECHNICIAN_ASSIGNED: ['ADMIN', 'PROVIDER'],
  TECHNICIAN_ON_THE_WAY: ['ADMIN', 'PROVIDER', 'TECHNICIAN'],
  ARRIVED: ['ADMIN', 'PROVIDER', 'TECHNICIAN'],
  SERVICE_IN_PROGRESS: ['ADMIN', 'PROVIDER', 'TECHNICIAN'],
  COMPLETED: ['ADMIN', 'PROVIDER', 'TECHNICIAN'],
  INVOICE_GENERATED: ['ADMIN'],
  PAYMENT_PENDING: ['ADMIN'],
  // PAID is intentionally ABSENT: only a verified payment webhook may settle it.
  PAID: [],
  FEEDBACK_PENDING: ['ADMIN'],
  CLOSED: ['ADMIN', 'CUSTOMER', 'PROVIDER'],
  CANCELLED: ['ADMIN', 'CUSTOMER', 'PROVIDER'],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedNextStatuses(from: BookingStatus): BookingStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function rolesAllowedFor(from: BookingStatus): Role[] {
  return TRANSITION_ROLES[from] ?? [];
}

export function isTerminal(status: BookingStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export type TransitionDecision =
  | { ok: true; next: BookingStatus }
  | { ok: false; code: 'INVALID_TRANSITION' | 'FORBIDDEN_ROLE' | 'TERMINAL'; reason: string };

/**
 * Decides whether `actorRole` may move a booking from `from` to `to`.
 * Used by the API layer; the UI only uses `allowedNextStatuses` for display.
 */
export function evaluateTransition(
  from: BookingStatus,
  to: BookingStatus,
  actorRole: Role,
): TransitionDecision {
  if (isTerminal(from)) {
    return { ok: false, code: 'TERMINAL', reason: `Booking is already ${from}.` };
  }
  if (!canTransition(from, to)) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      reason: `Cannot move a booking from ${from} to ${to}.`,
    };
  }
  // PAID has no initiating role at all - webhook only.
  const allowedRoles = TRANSITION_ROLES[from] ?? [];
  if (!allowedRoles.includes(actorRole)) {
    return {
      ok: false,
      code: 'FORBIDDEN_ROLE',
      reason: `Role ${actorRole} may not perform this transition.`,
    };
  }
  return { ok: true, next: to };
}

export function canCancel(from: BookingStatus, actorRole: Role): boolean {
  return canTransition(from, 'CANCELLED') && CANCELLABLE_BY.includes(actorRole);
}

const CANCELLABLE_BY: Role[] = ['ADMIN', 'CUSTOMER', 'PROVIDER'];

/** 0-based index in BOOKING_FLOW, or -1 for CANCELLED. */
export function flowIndex(status: BookingStatus): number {
  return BOOKING_FLOW.indexOf(status);
}

export const STATUS_LABEL: Record<BookingStatus, string> = {
  REQUESTED: 'Requested',
  CONFIRMED: 'Confirmed',
  TECHNICIAN_ASSIGNED: 'Technician assigned',
  TECHNICIAN_ON_THE_WAY: 'Technician on the way',
  ARRIVED: 'Arrived',
  SERVICE_IN_PROGRESS: 'Service in progress',
  COMPLETED: 'Completed',
  INVOICE_GENERATED: 'Invoice generated',
  PAYMENT_PENDING: 'Payment pending',
  PAID: 'Paid',
  FEEDBACK_PENDING: 'Feedback pending',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

/** Neutral copy shown instead of inventing live operational facts. */
export const STATUS_HINT: Record<BookingStatus, string> = {
  REQUESTED: 'Your request has been recorded. Confirmation follows shortly.',
  CONFIRMED: 'Confirmed. A technician will be assigned to this booking.',
  TECHNICIAN_ASSIGNED: 'A technician is assigned. Their details appear here once assigned.',
  TECHNICIAN_ON_THE_WAY: 'The technician has marked themselves on the way.',
  ARRIVED: 'The technician has arrived at your location.',
  SERVICE_IN_PROGRESS: 'Work is underway.',
  COMPLETED: 'Work is marked complete. The invoice is being generated.',
  INVOICE_GENERATED: 'Your invoice is ready.',
  PAYMENT_PENDING: 'Payment is pending. Status updates from the payment provider.',
  PAID: 'Payment confirmed.',
  FEEDBACK_PENDING: 'Please rate this service.',
  CLOSED: 'This booking is closed.',
  CANCELLED: 'This booking was cancelled.',
};

/**
 * True only when the booking is in a state where the customer may submit
 * feedback. Enforced again server-side on submission.
 */
export function canLeaveFeedback(status: BookingStatus): boolean {
  return status === 'FEEDBACK_PENDING' || status === 'PAID' || status === 'CLOSED';
}