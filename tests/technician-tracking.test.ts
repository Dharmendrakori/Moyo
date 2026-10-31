/// <reference types="vitest/globals" />

/**
 * CUSTOMER BOOKING TRACKING — TECHNICIAN PLACEMENT
 *
 * These are render tests against the real server component (`renderToStaticMarkup`
 * runs no effects, which is exactly what a server-rendered page does). They pin
 * the layout contract the milestone asked for:
 *
 *  - the assigned technician appears INSIDE the Current status card;
 *  - there is exactly one technician block, so nothing is duplicated further down
 *    the page;
 *  - an unassigned booking says so plainly instead of implying a technician exists;
 *  - Call/WhatsApp appear only when there is a usable number AND the technician is
 *    still on the roster, so a deactivated profile is never offered as a live
 *    contact route.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookingStatusPanel } from '../src/components/customer/BookingStatus';

const ASSIGNED: {
  displayName: string;
  headline: string | null;
  skills: string | null;
  phone: string | null;
  isActive: boolean;
} = {
  displayName: 'Ravi Kumar',
  headline: 'AC and refrigeration',
  skills: 'AC servicing, Refrigeration',
  phone: '9876500001',
  isActive: true,
};

function render(technician: typeof ASSIGNED | null) {
  return renderToStaticMarkup(
    createElement(BookingStatusPanel, { status: 'TECHNICIAN_ASSIGNED', technician }),
  );
}

describe('assigned technician placement', () => {
  it('renders the technician inside the current-status card', () => {
    const html = render(ASSIGNED);

    expect(html).toContain('Current status');
    expect(html).toContain('Your assigned technician');
    expect(html).toContain('Ravi Kumar');
    expect(html).toContain('AC and refrigeration');
    expect(html).toContain('AC servicing, Refrigeration');

    // The technician block must come AFTER the status heading, i.e. inside the
    // same card rather than in a second one further down.
    expect(html.indexOf('Current status')).toBeLessThan(html.indexOf('Your assigned technician'));
  });

  it('renders the technician exactly once (no duplicate card)', () => {
    const html = render(ASSIGNED);
    const occurrences = html.split('Ravi Kumar').length - 1;
    expect(occurrences).toBe(1);
    // The old standalone "Technician" card heading is gone.
    expect(html).not.toContain('<h3 class="text-sm font-semibold text-ink-900">Technician</h3>');
  });

  it('offers Call and WhatsApp when the number is usable', () => {
    const html = render(ASSIGNED);
    expect(html).toContain('href="tel:+9876500001"');
    expect(html).toContain('wa.me/9876500001');
  });

  it('omits both actions when the technician has no number', () => {
    const html = render({ ...ASSIGNED, phone: null });
    expect(html).toContain('Ravi Kumar');
    expect(html).not.toContain('href="tel:');
    expect(html).not.toContain('wa.me/');
  });

  it('keeps the name but withholds contact actions for a deactivated technician', () => {
    const html = render({ ...ASSIGNED, isActive: false });
    expect(html).toContain('Ravi Kumar');
    expect(html).toContain('off the roster');
    expect(html).not.toContain('href="tel:');
    expect(html).not.toContain('wa.me/');
  });

  it('shows a neutral message before any technician is assigned', () => {
    const html = render(null);
    expect(html).toContain('No technician has been assigned yet');
    expect(html).not.toContain('Your assigned technician</h3>Ravi');
    expect(html).not.toContain('href="tel:');
  });

  it('keeps the lifecycle history separate from the technician block', () => {
    const html = render(ASSIGNED);
    expect(html).toContain('Booking progress');
    expect(html.indexOf('Your assigned technician')).toBeLessThan(html.indexOf('Booking progress'));
  });
});
