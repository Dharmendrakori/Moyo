/// <reference types="vitest/globals" />
import {
  BOOKING_FLOW,
  allowedNextStatuses,
  canCancel,
  canLeaveFeedback,
  canTransition,
  evaluateTransition,
  flowIndex,
  isTerminal,
  STATUS_HINT,
  STATUS_LABEL,
} from '../src/lib/booking-state';
import type { BookingStatus, Role } from '../src/lib/domain';

/**
 * STATE MACHINE TESTS
 *
 * The state machine is the main defence against a client forcing a booking
 * straight to PAID or skipping verification steps, so its invariants are
 * asserted explicitly.
 */

describe('booking state machine', () => {
  it('covers the full specified lifecycle in order', () => {
    expect(BOOKING_FLOW).toEqual([
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
    ]);
  });

  it('allows only the immediate next step', () => {
    expect(allowedNextStatuses('REQUESTED')).toEqual(['CONFIRMED', 'CANCELLED']);
    expect(allowedNextStatuses('ARRIVED')).toEqual(['SERVICE_IN_PROGRESS', 'CANCELLED']);
    expect(allowedNextStatuses('SERVICE_IN_PROGRESS')).toEqual(['COMPLETED']);
  });

  it('forbids skipping from REQUESTED straight to COMPLETED', () => {
    expect(canTransition('REQUESTED', 'COMPLETED')).toBe(false);
    expect(canTransition('REQUESTED', 'PAID')).toBe(false);
    expect(canTransition('CONFIRMED', 'INVOICE_GENERATED')).toBe(false);
  });

  it('forbids moving backwards', () => {
    expect(canTransition('COMPLETED', 'ARRIVED')).toBe(false);
    expect(canTransition('PAID', 'PAYMENT_PENDING')).toBe(false);
  });

  it('treats CLOSED and CANCELLED as terminal', () => {
    expect(isTerminal('CLOSED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(allowedNextStatuses('CLOSED')).toEqual([]);
    expect(allowedNextStatuses('CANCELLED')).toEqual([]);
  });

  it('never allows any role to set PAID', () => {
    // The webhook is the only authority; no user role may trigger this edge.
    for (const role of ['CUSTOMER', 'PROVIDER', 'TECHNICIAN', 'ADMIN'] as Role[]) {
      const decision = evaluateTransition('PAYMENT_PENDING', 'PAID', role);
      expect(decision.ok).toBe(false);
      if (!decision.ok) {
        expect(decision.code).toBe('FORBIDDEN_ROLE');
      }
    }
  });

  it('allows admin and provider to confirm a request', () => {
    expect(evaluateTransition('REQUESTED', 'CONFIRMED', 'ADMIN').ok).toBe(true);
    expect(evaluateTransition('REQUESTED', 'CONFIRMED', 'PROVIDER').ok).toBe(true);
  });

  it('stops a customer from advancing operational statuses', () => {
    const decision = evaluateTransition('REQUESTED', 'CONFIRMED', 'CUSTOMER');
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('FORBIDDEN_ROLE');
  });

  it('lets a technician drive the on-site steps but not the commercial ones', () => {
    expect(evaluateTransition('TECHNICIAN_ASSIGNED', 'TECHNICIAN_ON_THE_WAY', 'TECHNICIAN').ok).toBe(
      true,
    );
    expect(evaluateTransition('ARRIVED', 'SERVICE_IN_PROGRESS', 'TECHNICIAN').ok).toBe(true);

    // Issuing an invoice is an administrative/commercial action.
    const invoiceDecision = evaluateTransition('COMPLETED', 'INVOICE_GENERATED', 'TECHNICIAN');
    expect(invoiceDecision.ok).toBe(false);
  });

  it('refuses any transition out of a terminal state', () => {
    const decision = evaluateTransition('CLOSED', 'FEEDBACK_PENDING', 'ADMIN');
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('TERMINAL');
  });

  it('allows customer and provider to cancel early work, but not a technician', () => {
    expect(canCancel('REQUESTED', 'CUSTOMER')).toBe(true);
    expect(canCancel('CONFIRMED', 'PROVIDER')).toBe(true);
    expect(canCancel('CONFIRMED', 'TECHNICIAN')).toBe(false);
    // Work already completed cannot be cancelled.
    expect(canCancel('COMPLETED', 'ADMIN')).toBe(false);
  });

  it('only accepts feedback in the appropriate states', () => {
    expect(canLeaveFeedback('FEEDBACK_PENDING')).toBe(true);
    expect(canLeaveFeedback('REQUESTED')).toBe(false);
    expect(canLeaveFeedback('SERVICE_IN_PROGRESS')).toBe(false);
  });

  it('provides a label and a neutral hint for every status', () => {
    const all: BookingStatus[] = [
      ...BOOKING_FLOW,
      'CANCELLED',
    ];
    for (const status of all) {
      expect(STATUS_LABEL[status], `missing label for ${status}`).toBeTruthy();
      expect(STATUS_HINT[status], `missing hint for ${status}`).toBeTruthy();
    }
  });

  it('never promises an ETA or a guarantee in its hints', () => {
    for (const hint of Object.values(STATUS_HINT)) {
      expect(hint).not.toMatch(/\d+\s*(min|mins|minutes)/i);
      expect(hint).not.toMatch(/guarantee/i);
      expect(hint).not.toMatch(/100%/i);
    }
  });

  it('reports a sensible progress index', () => {
    expect(flowIndex('REQUESTED')).toBe(0);
    expect(flowIndex('PAID')).toBe(BOOKING_FLOW.indexOf('PAID'));
    expect(flowIndex('CANCELLED')).toBe(-1);
  });
});