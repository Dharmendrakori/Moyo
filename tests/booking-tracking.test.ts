/// <reference types="vitest/globals" />
import {
  hasAssignedTechnician,
  projectLifecycle,
  summarisePrice,
} from '../src/lib/booking-tracking';
import { BOOKING_FLOW } from '../src/lib/booking-state';
import type { BookingStatus } from '../src/lib/domain';

/**
 * BOOKING TRACKING VIEW MODEL TESTS
 *
 * These assert the two honesty properties the customer tracking UI depends on:
 * a stage is never reported as complete unless the backend says so, and a
 * published price is never presented as the final invoice.
 */
describe('projectLifecycle', () => {
  it('marks only the stages before the current one as complete', () => {
    const at = (status: BookingStatus) => projectLifecycle(status);
    expect(at('REQUESTED').completedCount).toBe(0);
    expect(at('CONFIRMED').completedCount).toBe(1);
    expect(at('ARRIVED').completedCount).toBe(4);
    expect(at('PAID').completedCount).toBe(BOOKING_FLOW.indexOf('PAID'));
  });

  it('always reports exactly one current stage in the happy path', () => {
    for (const status of BOOKING_FLOW) {
      const projection = projectLifecycle(status);
      const current = projection.stages.filter((s) => s.state === 'current');
      expect(current, `expected one current stage for ${status}`).toHaveLength(1);
      expect(current[0]?.status).toBe(status);
    }
  });

  it('never marks a future stage as complete', () => {
    // REQUESTED is the first state: nothing after it may be complete.
    const projection = projectLifecycle('REQUESTED');
    for (const stage of projection.stages.slice(1)) {
      expect(stage.state).toBe('pending');
    }
  });

  it('returns every stage in the fixed lifecycle order', () => {
    const projection = projectLifecycle('SERVICE_IN_PROGRESS');
    expect(projection.stages.map((s) => s.status)).toEqual(BOOKING_FLOW);
  });

  it('treats a cancelled booking as having no progress at all', () => {
    const projection = projectLifecycle('CANCELLED');
    expect(projection.isCancelled).toBe(true);
    expect(projection.isTerminal).toBe(true);
    expect(projection.currentIndex).toBe(-1);
    expect(projection.completedCount).toBe(0);
    // Nothing may be shown as complete or current on a cancelled booking.
    expect(projection.stages.every((s) => s.state === 'pending')).toBe(true);
  });

  it('degrades safely for an unrecognised stored status', () => {
    const projection = projectLifecycle('PAID_BY_HACKER');
    expect(projection.currentStatus).toBeNull();
    expect(projection.currentIndex).toBe(-1);
    expect(projection.completedCount).toBe(0);
    expect(projection.stages.every((s) => s.state === 'pending')).toBe(true);
  });

  it('does not promise an ETA, a guarantee or availability in any next action', () => {
    for (const status of [...BOOKING_FLOW, 'CANCELLED'] as BookingStatus[]) {
      const action = projectLifecycle(status).nextAction;
      if (!action) continue;
      expect(action).not.toMatch(/\d+\s*(min|mins|minutes|hour|hours)/i);
      expect(action).not.toMatch(/guarantee/i);
      expect(action).not.toMatch(/available now/i);
      expect(action).not.toMatch(/100%/i);
    }
  });

  it('has no next action once a booking is finished or cancelled', () => {
    expect(projectLifecycle('CLOSED').nextAction).toBeNull();
    expect(projectLifecycle('CANCELLED').nextAction).toBeNull();
  });
});

describe('summarisePrice', () => {
  it('labels a published price as an estimate, never as the invoice', () => {
    const price = summarisePrice({
      charging: 'FIXED_CHARGE',
      quotedPaise: 50_000,
      budgetMinPaise: null,
      budgetMaxPaise: null,
    });
    expect(price.kind).toBe('published');
    expect(price.headline).toMatch(/estimate/i);
    expect(price.note).toMatch(/not the final invoice/i);
    expect(price.note).toMatch(/final invoice/i);
  });

  it('reports a budget range separately from a published price', () => {
    const price = summarisePrice({
      charging: 'CUSTOMER_BUDGET',
      quotedPaise: null,
      budgetMinPaise: 10_000,
      budgetMaxPaise: 20_000,
    });
    expect(price.kind).toBe('budget');
    expect(price.note).toMatch(/no fixed price/i);
  });

  it('says plainly when nothing has been published, and never implies zero', () => {
    const price = summarisePrice({
      charging: 'VISIT_CHARGE',
      quotedPaise: null,
      budgetMinPaise: null,
      budgetMaxPaise: null,
    });
    expect(price.kind).toBe('unpublished');
    expect(price.headline).toBe('Price not published');
    expect(price.quotedPaise).toBeNull();
    expect(price.note).toMatch(/has not published/i);
  });

  it('treats a zero quote as unpublished rather than as a free service', () => {
    const price = summarisePrice({
      charging: 'VISIT_CHARGE',
      quotedPaise: 0,
      budgetMinPaise: null,
      budgetMaxPaise: null,
    });
    expect(price.kind).toBe('unpublished');
  });

  it('falls back to the raw charging value for an unknown option', () => {
    const price = summarisePrice({
      charging: 'SOMETHING_ELSE',
      quotedPaise: null,
      budgetMinPaise: null,
      budgetMaxPaise: null,
    });
    expect(price.chargingLabel).toBe('SOMETHING_ELSE');
  });
});

describe('hasAssignedTechnician', () => {
  it('is false until a technician is really assigned', () => {
    expect(hasAssignedTechnician(null)).toBe(false);
    expect(hasAssignedTechnician(undefined)).toBe(false);
    expect(hasAssignedTechnician({ displayName: '' })).toBe(false);
    expect(hasAssignedTechnician({ displayName: '   ' })).toBe(false);
  });

  it('is true only for a real, named technician', () => {
    expect(hasAssignedTechnician({ displayName: 'Assigned Tech' })).toBe(true);
  });
});
